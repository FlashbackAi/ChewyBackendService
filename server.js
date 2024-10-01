import express from 'express';
import winston from 'winston';
import cors from 'cors';
import dotenv from 'dotenv';
import { AWS, AmazonCognitoIdentity, userPool, docClient, poolData } from './config.js';
import { CognitoUserPool, CognitoUserAttribute } from 'amazon-cognito-identity-js';
import { Account, AptosConfig, Aptos, Network, Ed25519PrivateKey, AccountAddress } from '@aptos-labs/ts-sdk';
import { aptosConfig } from './config.js';
import fs from 'fs';
import https from 'https';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const userDataTableName = 'users';
const walletDetailsTable = 'wallet_details';
const userBucketName = 'chewyusersavedata';
const walletTransactionsTable = 'wallet_transactions';

// Aptos and chewy info
const config = new AptosConfig({ network: Network.MAINNET});
const aptosClient = new Aptos(config);
const APTOS_AMOUNT = 30000000;
const CHEWY_AMOUNT =1000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));



// Create a format that includes the timestamp
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss', // Customize if needed
  }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

// Create the logger
const logger = winston.createLogger({
  format: logFormat, // Apply the log format
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/application.log' }),
  ],
});


app.post('/signup', async function (req, res) {
    try {   
      const username = req.body.username.toLowerCase();
      const Chewy = 'Chewy';
      // This will create a unique userId with format "Flash" as Prefix _"Username"_"random number" Eg: Flash_srialla_098
      const referralId = `${Chewy}_${username}_${Math.floor(Math.random() * 1000)}`;
      const created_date = new Date().toISOString(); // Created date of the user registration
      
      // DynamoDB params for checking if username exists
      const checkUserParams = {
        TableName: userDataTableName,
        Key: {
          email: req.body.email,
        },
      };
  
      // Check if the username already exists in DynamoDB
      const existingUser = await docClient.get(checkUserParams).promise();
  
      if (existingUser.Item) {
        return res.status(409).json({ message: 'Username already exists.' });
      }
  
      // DynamoDB params for user_data table
      const userDataParams = {
        TableName: userDataTableName,
        Item: {
          user_name: username,
          referral_id: referralId,
          email: req.body.email,
          password: req.body.password,
          created_date: created_date,
        },
      };
  
      await docClient.put(userDataParams).promise();
  
      var userPool = new CognitoUserPool(poolData);
      logger.info(req.body);
  
      // Create email attribute for Cognito
      const emailAttribute = new CognitoUserAttribute({
        Name: 'email',
        Value: req.body.email,
      });
  
      var attributeList = [];
      attributeList.push(emailAttribute);
  
      // Sign up the user with email only, no phone number
      userPool.signUp(req.body.username, req.body.password, attributeList, null, function (err, result) {
        if (err) {
          res.status(500).send(err.message);
          logger.info(err.message);
          return;
        }
        res.send({ status: 'Success', message: 'User registered successfully. Please check your email for OTP.' });
      });
    } catch (err) {
      logger.error(`Error creating user:`, err);
      res.status(500).send(err.message);
    }
  });
  
  
  
  app.post('/resend-verification', (req, res) => {  
    const params = {
      Username: req.body.username,
      ClientId: poolData.ClientId
    };
   // const params = poolData.add(username)
  
    cognitoidentityserviceprovider.resendConfirmationCode(params, function(err, data) {
      if (err) {
        console.error(err);
        res.status(500).send(err.message);
      } else {
        res.send({ message: 'Verification code resent successfully' });
      }
    });
  });
  
  
  app.post('/confirmUser', async function(req, res) {
    try {
      const username = req.body.username;
      const confirmationCode = req.body.verificationCode;
      
      const userData = {
        Username: username,
        Pool: userPool,
      };
      
      const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
      
      // Wrap the confirmRegistration in a promise to use async/await
      const confirmUserPromise = () => {
        return new Promise((resolve, reject) => {
          cognitoUser.confirmRegistration(confirmationCode, true, function(err, result) {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        });
      };
  
      // Wait for the user confirmation to complete
      const result = await confirmUserPromise();
      
      // Call the handleWalletCreation function after the user is confirmed
      await handleWalletCreation(req.body.email);
  
      // Send success response
      res.json({ status: 'Success', message: 'User confirmed and wallet created successfully' });
  
    } catch (err) {
      res.status(500).send("User confirmation failed or wallet creation failed");
    }
  });
  

  async function handleWalletCreation(email) {
    logger.info(`Received request to create wallet for email: ${email}`);
    
    try {
      // Check if the wallet already exists for the given email
      const existingWallet = await checkWalletExists(email);
  
      if (existingWallet) {
        // If the wallet exists, return the existing wallet details
        logger.info(`Wallet already exists for email: ${email}`);
        return {
          message: 'Wallet already exists',
          walletAddress: existingWallet.wallet_address,
          balance: existingWallet.balance,
          status: 200
        };
      }
  
      // If no wallet exists, create a new Aptos wallet
      const aptosAccount = Account.generate();
      logger.info("Account created Successfully");
  
      // Encrypt the private key and prepare wallet details
      const encryptedPrivateKey = aptosAccount.privateKey.signingKey.toString('hex');  // Encryption can be added as per your logic
  
      const walletDetails = {
        walletAddress: aptosAccount.accountAddress.toString('hex'),  // Hex representation of the wallet address
        publicKey: aptosAccount.publicKey.key.toString('hex'),  // Hex representation of the public key
        balance: CHEWY_AMOUNT,
        encryptedPrivateKey,  // The encrypted private key
      };
  
      // Store the wallet info in DynamoDB
      await storeWalletInDynamoDB(email, walletDetails);
  
      // Log successful wallet creation
      logger.info(`Aptos Wallet created for email: ${email} with wallet address: ${walletDetails.walletAddress}`);
  
      // Transfer Aptos coins to the newly created wallet
      const transactionStatus = await transferAptosCoins(walletDetails.walletAddress, APTOS_AMOUNT || aptosConfig.DEFAULT_TRANSFER_AMOUNT,aptosConfig.SENDER_EMAIL, email);
  
      if (transactionStatus !== true) {
        throw new Error("Transaction failed");
      }
  
      // Register the wallet with ChewyCoin store and transfer coins
      await registerChewyCoinStore(aptosAccount, aptosAccount.accountAddress);
      await transferChewyCoins(walletDetails.walletAddress, CHEWY_AMOUNT, aptosConfig.SENDER_EMAIL, email);
  
      // Return wallet details and transaction status
      return {
        message: 'Aptos Wallet created and coins transferred successfully',
        walletAddress: walletDetails.walletAddress,
        transactionStatus: transactionStatus,
        balance: CHEWY_AMOUNT || aptosConfig.DEFAULT_TRANSFER_AMOUNT,
        status: 201
      };
    } catch (error) {
      // Log any error that occurs during the process
      logger.error(`Error creating Aptos wallet for email: ${email}: ${error.message}`);
      throw new Error(`Failed to create Aptos wallet: ${error.message}`);
    }
  }

  const checkWalletExists = async (email) => {
    const params = {
      TableName: 'wallet_details',
      Key: {
        email: email
      }
    };
  
    try {
      const result = await docClient.get(params).promise();  // Use docClient
      return result.Item ? result.Item : null;
    } catch (error) {
      logger.error(`Error checking wallet for email: ${email}: ${error.message}`);
      throw error;
    }
  };

  const storeWalletInDynamoDB = async (email, walletDetails) => {
    const params = {
      TableName: 'wallet_details',
      Item: {
        email: email,
        wallet_address: walletDetails.walletAddress,
        public_key: walletDetails.publicKey,
        encrypted_private_key: walletDetails.encryptedPrivateKey,
        balance: walletDetails.balance,  // Set balance as '0'
      }
    };
  
    try {
      await docClient.put(params).promise();  // Use docClient
      logger.info(`Wallet info stored in DynamoDB for email ${email}`);
    } catch (error) {
      logger.error(`Error storing wallet info in DynamoDB for email: ${email}: ${error.message}`);
      throw error;
    }
  };

  // Function to fund the account
  const transferAptosCoins = async ( recipientAddress, amount, senderEmail,recipientEmail) => {
    try {
      // to derive an account with a private key and account address
      const senderWalletDetails = await fetchWalletDetails(senderEmail);
      const privateKeyHex = senderWalletDetails.encrypted_private_key.startsWith('0X')
      ? senderWalletDetails.encrypted_private_key.slice(2) // Remove the '0x' prefix
      : senderWalletDetails.encrypted_private_key;
    
      // Derive an account with a private key and account address
      const privateKey = new Ed25519PrivateKey(privateKeyHex);
      const address = AccountAddress.from(senderWalletDetails.wallet_address);
      const senderAccount = Account.fromPrivateKey({ privateKey, address });
  
      // Generate and sign the transaction
      //Generate
      const transaction = await aptosClient.transaction.build.simple({
        sender: senderAccount.accountAddress,
        data: {
          // All transactions on Aptos are implemented via smart contracts.
          type: 'entry_function_payload',
          function: "0x1::aptos_account::transfer",
         functionArguments: [recipientAddress, amount],
        },
      });
  
      //Sign
      const senderAuthenticator = aptosClient.transaction.sign({
        signer: senderAccount,
        transaction,
      });
  
      logger.info("Transaction generated and Signed Successfully");
      // If the fee looks ok, continue to signing!
  
      // Submit the transaction    
      const committedTransaction = await aptosClient.transaction.submit.simple({
        transaction,
        senderAuthenticator,
      });
      logger.info(`Transaction submitted: ${committedTransaction.hash}`);
  
      // Wait for confirmation
      const executedTransaction = await aptosClient.waitForTransaction({ transactionHash: committedTransaction.hash });
      logger.info(`Transaction confirmed: ${executedTransaction.success}`);
      
      await updateWalletTransaction(
        executedTransaction.hash, 
        senderEmail,
        recipientEmail, 
        senderWalletDetails.wallet_address,         // Sender's wallet address (from_address)
        recipientAddress,      // Receiver's wallet address (to_address)
        amount, 
        executedTransaction.success, 
        "Aptos"                           // Type of coin being transferred
      );
      return executedTransaction.success;
      
    } catch (error) {
      logger.error(`Error funding account: ${error.message}`);
      throw new Error(error.message);
    }
  };

  /** Register the receiver account to receive transfers for Chewy Coin. */
    async function registerChewyCoinStore(receiver){
        try {
        // Build the transaction for registering the CoinStore
        const transaction = await aptosClient.transaction.build.simple({
            sender: receiver.accountAddress,
            data: {
            function: "0x1::managed_coin::register",  // Use the managed_coin::register function
            typeArguments: [`0xc26a8eda1c3ab69a157815183ddda88c89d6758ee491dd1647a70af2907ce074::coin::Chewy`],
            functionArguments: [],  // No arguments needed
            },
        });
    
        const [userTransactionResponse] = await aptosClient.transaction.simulate.simple({
            signerPublicKey: receiver.publicKey,
            transaction,
        });
        logger.info(userTransactionResponse)
    
        // Sign the transaction with the receiver's account
        const senderAuthenticator = aptosClient.transaction.sign({ signer: receiver, transaction });
    
        // Submit the transaction to the blockchain
        const pendingTxn = await aptosClient.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });
    
        console.log(`Transaction submitted. Hash: ${pendingTxn.hash}`);
    
        // Wait for the transaction to be confirmed
        await aptosClient.waitForTransaction({ transactionHash: pendingTxn.hash });
        console.log(`Transaction confirmed. Hash: ${pendingTxn.hash}`);
    
        return pendingTxn.hash;
        } catch (error) {
        console.error(`Error registering Chewy Coin: ${error.message}`);
        throw new Error(error.message);
        }
    }
    const transferChewyCoins = async (recipientAddress, amount, senderEmail, recipientEmail) => {
        try {
          // Fetch wallet details for the sender
          const senderWalletDetails = await fetchWalletDetails(senderEmail);
          const privateKeyHex = senderWalletDetails.encrypted_private_key.startsWith('0X')
        ? senderWalletDetails.encrypted_private_key.slice(2) // Remove the '0x' prefix
        : senderWalletDetails.encrypted_private_key;
      
          // Derive an account with a private key and account address
          const privateKey = new Ed25519PrivateKey(privateKeyHex);
          const address = AccountAddress.from(senderWalletDetails.wallet_address);
          const senderAccount = Account.fromPrivateKey({ privateKey, address });
      
          // Generate and sign the transaction
          const transaction = await aptosClient.transaction.build.simple({
            sender: senderAccount.accountAddress,
            data: {
              type: 'entry_function_payload',
              function: '0x1::coin::transfer',
              typeArguments: ['0xc26a8eda1c3ab69a157815183ddda88c89d6758ee491dd1647a70af2907ce074::coin::Chewy'],  // Chewy Coin type
              functionArguments: [recipientAddress, amount],
            },
          });
      
          // Sign the transaction
          const senderAuthenticator = aptosClient.transaction.sign({
            signer: senderAccount,
            transaction,
          });
      
          logger.info("Transaction generated and Signed Successfully");
          const [userTransactionResponse] = await aptosClient.transaction.simulate.simple({
            signerPublicKey: senderAccount.publicKey,
            transaction,
        });
        logger.info(userTransactionResponse.max_gas_amount)
      
          // Submit the transaction    
          const committedTransaction = await aptosClient.transaction.submit.simple({
            transaction,
            senderAuthenticator,
          });
          logger.info(`Transaction submitted: ${committedTransaction.hash}`);
      
          // Wait for confirmation
          const executedTransaction = await aptosClient.waitForTransaction({ transactionHash: committedTransaction.hash });
          logger.info(`Transaction confirmed: ${executedTransaction.success}`);
      
          // Update the wallet transaction details
          await updateWalletTransaction(
            executedTransaction.hash,
            senderEmail,
            recipientEmail,
            senderWalletDetails.wallet_address, // Sender's wallet address (from_address)
            recipientAddress, // Receiver's wallet address (to_address)
            amount,
            executedTransaction.success,
            "Chewy" // Type of coin being transferred
          );
      
          return executedTransaction.success;
      
        } catch (error) {
          console.error(`Error transferring Chewy coins: ${error.message}`);
          throw new Error(error.message);
        }
    };

    const fetchWalletDetails = async (senderEmail) => {
    if (!senderEmail) {
        throw new Error("Email is required");
    }

    // Define the DynamoDB query parameters
    const params = {
        TableName: 'wallet_details',
        Key: {
        email: senderEmail
        }
    };

    try {
        logger.info(`Fetching wallet for Email: ${senderEmail}`);

        // Fetch wallet from DynamoDB
        const result = await docClient.get(params).promise();

        logger.info(`Fetched wallet for email: ${senderEmail}`);

        // If no wallet found, throw an error
        if (!result || !result.Item) {
        throw new Error("Wallet not found");
        }

        // Return the wallet details
        return result.Item;

    } catch (error) {
        // Log the error and rethrow it
        logger.error(`Error fetching wallet for mail ${senderEmail}: ${error.message}`);
        throw error;
    }
    };
    // Function to update wallet transaction in DynamoDB
async function updateWalletTransaction(transactionId, senderEmail,recipientEmail, fromAddress, toAddress, amount, transactionStatus, coinType) {
    const params = {
      TableName: 'wallet_transactions',  // DynamoDB table name
      Item: {
        transaction_id: transactionId,  // Primary key: transaction ID provided by the SDK
        from_email: senderEmail,
        to_email:recipientEmail,
        from_address: fromAddress,      // From address (sender's wallet address)
        to_address: toAddress,          // To address (receiver's wallet address)
        amount: amount,                 // Amount of coins transferred
        coin_type: coinType,            // Type of coin being transferred (e.g., Aptos, ChewyCoin)
        status: transactionStatus,      // Status of the transaction (e.g., COMPLETED, FAILED)
        transaction_date: new Date().toISOString()  // Storing the transaction date
      }
    };
  
    try {
      // Insert the transaction details into the DynamoDB table
      await docClient.put(params).promise();
      logger.info(`Transaction with ID ${transactionId} successfully logged in wallet_transactions table`);
      return true;
    } catch (error) {
      logger.error(`Error updating transaction with ID ${transactionId}: ${error.message}`);
      throw new Error(`Failed to update transaction: ${error.message}`);
    }
  }
  
  app.post('/login', function(req, res) {
    
    const  username = req.body.username;
    const password = req.body.password;
  
    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: username,
        Password: password
    });
    const userData = {
        Username: username,
        Pool: userPool
    };
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
  
    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (result) => {
            const accessToken = result.getAccessToken().getJwtToken();
            const decodedCAccessToken = result.getIdToken().decodePayload()
            logger.info(`Result: ${result}`);
            res.json({ status: 'Success', message: 'Login successful', accessToken, username: decodedCAccessToken['cognito:username'], email: decodedCAccessToken['email']});
        },
        onFailure: (err) => {
          logger.info(err.message)
            res.status(500).send(err.message);
        },
        mfaSetup: (challengeName, challengeParameters) => {
          // MFA setup logic here
          // You might want to send a response to the user indicating that MFA setup is required
          logger.info("usr logged in")
      },
    });
  });

  app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
  
    const params = {
        ClientId: poolData.ClientId,
        Username: email,
    };
  
    cognitoidentityserviceprovider.forgotPassword(params, (err, data) => {
        if (err) {
            console.error(err);
            res.status(500).json({ message: 'Error initiating password reset' });
        } else {
            res.json({ message: 'Password reset initiated, check your email' });
        }
    });
  });
  
  app.post('/reset-password', (req, res) => {
    const { email, code, newPassword } = req.body;
  
    const params = {
        ClientId: poolData.ClientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
    };
  
    cognitoidentityserviceprovider.confirmForgotPassword(params, (err, data) => {
        if (err) {
            console.error(err);
            res.status(500).json({ message: 'Error resetting password' });
        } else {
            res.json({ message: 'Password reset successfully' });
        }
    });
  });
  

  app.post('/createWallet', async (req, res) => {
    const { email } = req.body;  // Accept the mobileNumber from the request
  
    try {
      const response = await handleWalletCreation(email);
      res.status(response.status).json(response);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create Aptos wallet', error: error.message });
    }
  });


  app.post('/transfer-chewy-coins-by-wallet-address', async (req, res) => {
    try {
        const { amount, senderEmail,recipientAddress} = req.body;
  
        // Log incoming request
        logger.info(`Transfer request received: amount = ${amount}`);
  
        // Read sender's private key and recipient address from config
          
        //const recipientAddress = aptosConfig.RECIPIENT_ADDRESS;
        const transferAmount = amount ;  // Use provided amount or default

        const status = await transferChewyCoins(recipientAddress, transferAmount,senderEmail, '');
  
        res.status(200).json({
            message: 'Chewy Coin transfer successful',
            status: status
        });
    } catch (error) {
        logger.error(`Transfer failed: ${error}`);
        res.status(500).json({ error: 'Chewy Coin transfer failed', details: error.message });
    }
  });
  
  app.post('/transfer-chewy-coins', async (req, res) => {
    try {
        const { amount, senderEmail,recipientEmail} = req.body;
  
        // Log incoming request
        logger.info(`Transfer request received: amount = ${amount}`);
  
        // Read sender's private key and recipient address from config
          
        const transferAmount = amount ;  // Use provided amount or default
        const recipientWalletDetails = await fetchWalletDetails(recipientEmail)
  
        // const status = await transferAptosCoins(recipientAddress, transferAmount);
        const status = await transferChewyCoins(recipientWalletDetails.wallet_address, transferAmount,senderEmail, recipientEmail);
  
        res.status(200).json({
            message: 'Chewy Coin transfer successful',
            status: status
        });
    } catch (error) {
        logger.error(`Transfer failed: ${error}`);
        res.status(500).json({ error: 'Chewy Coin transfer failed', details: error.message });
    }
  });

  app.get('/wallet-balance/:email', async (req, res) => {
    const { email } = req.params;
  
    try {
      // Get wallet details from DynamoDB
      const walletDetails = await fetchWalletDetails(email);
      const userDetails = await getUserObjectByUserPhoneNumber(email);
  
      if (!walletDetails) {
        return res.status(404).json({ message: 'Wallet not found' });
      }
  
      // Get the balance of the wallet
      const balance = await getWalletBalance(walletDetails.wallet_address);
  
      if(balance!=userDetails.reward_points){
        updateUserDetails(email,{reward_points:balance})
      }
      // Return the wallet details and balance
      res.status(200).json({
        walletAddress: walletDetails.wallet_address,
        balance: balance,
      });
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
      res.status(500).json({ message: 'Error fetching wallet balance', error: error.message });
    }
  });
  
  async function getUserObjectByUserPhoneNumber(email){
    try{
      logger.info("getting user info for email : "+email);
      const params = {
        TableName: userDataTableName,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": email
        }
      };
      const result = await docClient.scan(params).promise();
  
      if (result.Items.length === 0) {
        throw new Error("email not found");
      }
      logger.info("user details fetched successfully");
      return result.Items[0];
    } catch (error) {
      console.error("Error getting user object:", error);
      throw error;
    }
  }
    

  // Function to get balance using Aptos SDK
const getWalletBalance = async (walletAddress) => {
  try {
    const resources = await aptosClient.getAccountResource({ accountAddress: walletAddress,
      resourceType: "0x1::coin::CoinStore<0xc26a8eda1c3ab69a157815183ddda88c89d6758ee491dd1647a70af2907ce074::coin::Chewy>"})
      

    if (resources) {
      // Get the coin balance from the resource data
      return resources.coin.value;
    } else {
      return 0; // No balance found
    }
  } catch (error) {
    throw new Error(`Error fetching wallet balance: ${error.message}`);
  }
};

const updateUserDetails = async (email, updateFields) => {
  if (!email) {
    throw new Error("User phone number is required");
  }

  if (Object.keys(updateFields).length === 0) {
    throw new Error("At least one field to update must be provided");
  }

  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.keys(updateFields).forEach(key => {
    updateExpressions.push(`#${key} = :${key}`);
    expressionAttributeNames[`#${key}`] = key;
    expressionAttributeValues[`:${key}`] = updateFields[key];
  });

  const params = {
    TableName: userDataTableName,
    Key: {
      email: email
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  };

  // Perform the update operation
  const result = await docClient.update(params).promise();
  return result.Attributes;
};

  
// Use this for development testing and comment it out when using https for production
const server = app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
  server.keepAliveTimeout = 60000; // Increase keep-alive timeout
  server.headersTimeout = 65000; // Increase headers timeout
});
