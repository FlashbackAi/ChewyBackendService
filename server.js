import express from 'express';
import winston from 'winston';
import cors from 'cors';
import dotenv from 'dotenv';
import { AWS, AmazonCognitoIdentity, userPool,docClient, poolData } from './config.js';
import { CognitoUserPool, CognitoUserAttribute } from 'amazon-cognito-identity-js';



dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const userDataTableName = 'users';
const walletDetailsTable = 'wallet_details';
const userUploadsTableName = 'userUploads';
const userBucketName = 'chewyusersavedata';
const walletTransactionsTable = 'wallet_transactions';

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
        const data = {
          status: 'Success',
          message: 'User registered successfully',
        };
        res.send(data);
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
  
  
  app.post('/confirmUser', function(req, res) {
    
    const  username = req.body.username;
    const confirmationCode = req.body.verificationCode;
    const userData = {
        Username: username,
        Pool: userPool
    };
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    cognitoUser.confirmRegistration(confirmationCode, true, function(err, result) {
      if (err) {
          res.status(500).send("User Confirmation failed");
      }
      else{
      const data={
        status:'Success',
        message:'User confirmed successfully',
        data:result
      }
      res.send(data);
    }
  });
  });
  
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
           
            // You can also get idToken and refreshToken here
            const data={
              status:'Success',
              message:'User LoggedIn successfully',
              accessToken:accessToken,
              username:decodedCAccessToken['cognito:username']
  
            }
            res.send(data);
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
  
  




//  // *** Comment these certificates while testing changes in local developer machine. And, uncomment while pushing to mainline***
// const privateKey = fs.readFileSync('/etc/letsencrypt/live/flashback.wtf/privkey.pem', 'utf8');
// const certificate = fs.readFileSync('/etc/letsencrypt/live/flashback.wtf/fullchain.pem', 'utf8');
// const credentials = {
//   key: privateKey,
//   cert: certificate
// }

// Uncomment the following block of code for production HTTPS setup
// import https from 'https'; // Make sure you import https if you're using it
// const httpsServer = https.createServer(credentials, app);

// httpsServer.listen(PORT, () => {
//   logger.info(`Server is running on https://localhost:${PORT}`);
//   httpsServer.keepAliveTimeout = 60000; // Increase keep-alive timeout
//   httpsServer.headersTimeout = 65000; // Increase headers timeout
// });

// Use this for development testing and comment it out when using https for production
const server = app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
  server.keepAliveTimeout = 60000; // Increase keep-alive timeout
  server.headersTimeout = 65000; // Increase headers timeout
});
