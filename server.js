import express from 'express';
import winston from 'winston';
import cors from 'cors';
import dotenv from 'dotenv';
import { AWS, AmazonCognitoIdentity, userPool, docClient, poolData } from './config.js';
import { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute } from 'amazon-cognito-identity-js';
import { Account, AptosConfig, Aptos, Network, Ed25519PrivateKey, AccountAddress } from '@aptos-labs/ts-sdk';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const userDataTableName = 'users';
const walletDetailsTable = 'wallet_details';
const walletTransactionsTable = 'wallet_transactions';

// Aptos configuration and constants
const aptosClient = new Aptos(new AptosConfig({ network: Network.MAINNET }));
const APTOS_AMOUNT = 30000000;
const CHEWY_AMOUNT = 1000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Logger setup
const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/application.log' }),
  ],
});

// ----------------------- Signup Route -----------------------
app.post('/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const usernameLower = username.toLowerCase();
    const referralId = `Chewy_${usernameLower}_${Math.floor(Math.random() * 1000)}`;
    const createdDate = new Date().toISOString();

    const checkUserParams = { TableName: userDataTableName, Key: { email } };
    const existingUser = await docClient.get(checkUserParams).promise();

    if (existingUser.Item) {
      return res.status(409).json({ message: 'Email already exists.' });
    }

    const userDataParams = {
      TableName: userDataTableName,
      Item: { user_name: usernameLower, referral_id: referralId, email, password, created_date: createdDate },
    };

    await docClient.put(userDataParams).promise();

    const userPool = new CognitoUserPool(poolData);
    const emailAttribute = new CognitoUserAttribute({ Name: 'email', Value: email });
    const attributeList = [emailAttribute];

    userPool.signUp(username, password, attributeList, null, (err) => {
      if (err) {
        logger.error(`Error signing up user: ${err.message}`);
        return res.status(500).send(err.message);
      }
      res.send({ status: 'Success', message: 'User registered successfully. Please check your email for OTP.' });
    });
  } catch (err) {
    logger.error(`Error creating user: ${err.message}`);
    res.status(500).send('Server error');
  }
});

// ----------------------- OTP Verification Route -----------------------
app.post('/confirmUser', async (req, res) => {
  try {
    const { username, verificationCode, email } = req.body;

    if (!username || !verificationCode) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const userData = { Username: username, Pool: userPool };
    const cognitoUser = new CognitoUser(userData);

    // Confirm registration
    await new Promise((resolve, reject) => {
      cognitoUser.confirmRegistration(verificationCode, true, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    // Create wallet after confirmation
    const walletResponse = await handleWalletCreation(email);

    res.json({ status: 'Success', message: 'User confirmed and wallet created successfully', walletResponse });
  } catch (err) {
    logger.error(`Error confirming user or creating wallet: ${err.message}`);
    res.status(500).send('User confirmation or wallet creation failed');
  }
});

// ----------------------- Login Route -----------------------
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Missing required fields: username or password' });
  }

  const authenticationDetails = new AuthenticationDetails({ Username: username, Password: password });
  const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });

  cognitoUser.authenticateUser(authenticationDetails, {
    onSuccess: (result) => {
      const accessToken = result.getAccessToken().getJwtToken();
      const decodedToken = result.getIdToken().decodePayload();
      res.json({ status: 'Success', message: 'Login successful', accessToken, username: decodedToken['cognito:username'] });
    },
    onFailure: (err) => {
      logger.error(`Login failed: ${err.message}`);
      res.status(500).json({ message: 'Login failed', error: err.message });
    },
  });
});

// ----------------------- Wallet Creation Function -----------------------
async function handleWalletCreation(email) {
  logger.info(`Creating wallet for email: ${email}`);

  try {
    // Check if the wallet already exists
    const existingWallet = await checkWalletExists(email);
    if (existingWallet) {
      logger.info(`Wallet already exists for email: ${email}`);
      return { message: 'Wallet already exists', walletAddress: existingWallet.wallet_address, balance: existingWallet.balance };
    }

    // Create a new wallet
    const aptosAccount = Account.generate();
    const walletDetails = {
      walletAddress: aptosAccount.accountAddress.toString('hex'),
      publicKey: aptosAccount.publicKey.key.toString('hex'),
      encryptedPrivateKey: aptosAccount.privateKey.signingKey.toString('hex'),
      balance: CHEWY_AMOUNT,
    };

    await storeWalletInDynamoDB(email, walletDetails);
    await transferAptosCoins(walletDetails.walletAddress, APTOS_AMOUNT);

    return { message: 'Wallet created', walletDetails };
  } catch (error) {
    logger.error(`Error creating wallet: ${error.message}`);
    throw new Error(`Failed to create wallet: ${error.message}`);
  }
}

// ----------------------- Check Wallet Existence -----------------------
const checkWalletExists = async (email) => {
  const params = { TableName: walletDetailsTable, Key: { email } };
  const result = await docClient.get(params).promise();
  return result.Item || null;
};

// ----------------------- Store Wallet in DynamoDB -----------------------
const storeWalletInDynamoDB = async (email, walletDetails) => {
  const params = {
    TableName: walletDetailsTable,
    Item: {
      email: email,
      wallet_address: walletDetails.walletAddress,
      public_key: walletDetails.publicKey,
      encrypted_private_key: walletDetails.encryptedPrivateKey,
      balance: walletDetails.balance,
    },
  };
  await docClient.put(params).promise();
};

// ----------------------- Transfer Aptos Coins -----------------------
const transferAptosCoins = async (recipientAddress, amount) => {
  logger.info(`Transferring ${amount} Aptos coins to ${recipientAddress}`);
  // Code to transfer coins using Aptos SDK (implementation would go here)
};

// ----------------------- Forgot Password Route -----------------------
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  const params = { ClientId: poolData.ClientId, Username: email };

  cognitoidentityserviceprovider.forgotPassword(params, (err, data) => {
    if (err) {
      logger.error(`Error initiating password reset: ${err.message}`);
      res.status(500).json({ message: 'Error initiating password reset' });
    } else {
      res.json({ message: 'Password reset initiated, check your email' });
    }
  });
});

// ----------------------- Reset Password Route -----------------------
app.post('/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;

  const params = {
    ClientId: poolData.ClientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  };

  cognitoidentityserviceprovider.confirmForgotPassword(params, (err) => {
    if (err) {
      logger.error(`Error resetting password: ${err.message}`);
      res.status(500).json({ message: 'Error resetting password' });
    } else {
      res.json({ message: 'Password reset successfully' });
    }
  });
});

// ----------------------- Wallet Transaction Logging -----------------------
async function updateWalletTransaction(transactionId, senderEmail, recipientEmail, fromAddress, toAddress, amount, status, coinType) {
  const params = {
    TableName: walletTransactionsTable,
    Item: {
      transaction_id: transactionId,
      from_email: senderEmail,
      to_email: recipientEmail,
      from_address: fromAddress,
      to_address: toAddress,
      amount: amount,
      coin_type: coinType,
      status: status,
      transaction_date: new Date().toISOString(),
    },
  };
  await docClient.put(params).promise();
}

// ----------------------- Create Wallet Manually (API) -----------------------
app.post('/createWallet', async (req, res) => {
  const { email } = req.body;
  try {
    const walletResponse = await handleWalletCreation(email);
    res.status(walletResponse.status || 201).json(walletResponse);
  } catch (error) {
    logger.error(`Failed to create wallet: ${error.message}`);
    res.status(500).json({ message: 'Failed to create wallet', error: error.message });
  }
});

// ----------------------- Start the Server -----------------------
const server = app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
});
