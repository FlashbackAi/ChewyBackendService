import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import AmazonCognitoIdentity from 'amazon-cognito-identity-js';

dotenv.config();

// Set AWS region
AWS.config.update({ 
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'AKIAQ4NSBRVNRY6M5U47',
        secretAccessKey: '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',
    },
});

// Initialize AWS SDK Services
//const rekognition = new AWS.Rekognition({ region: 'ap-south-1' });
const dynamoDB = new AWS.DynamoDB({ region: 'us-east-1' });
const docClient = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });

// Amazon Cognito User Pool
const poolData = {
    UserPoolId: 'us-east-1_1dVGyx4BM',
    ClientId: '6ignh2nv1qg6suh60lgv7btf51',
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

const s3 = new AWS.S3({ // accessKey and SecretKey is being fetched from config.js
    region: 'us-east-1' // Update with your AWS region 
  });

  const aptosConfig = {
    SENDER_EMAIL:'anirudhpatel.thadem@gmail.com',
    APTOS_NODE_URL: 'https://fullnode.mainnet.aptoslabs.com/v1',
    SENDER_ADDRESS: '0xad42dbc223a72cf73c5c653dafde255cab01d73103acf49988c7f2eb43f2dd08',
    SENDER_PRIVATE_KEY: '0X53632582437017e387f177fe158a35c0f7ac58a8a476a2d69f77650f3a54b644',//process.env.SENDER_PRIVATE_KEY, // Sender's private key
    RECIPIENT_ADDRESS: '1b8dab4f14b7f78399a456d7ad7d2e974838b6cd3f4b6c6757b8b375d9a3c7a5',//process.env.RECIPIENT_ADDRESS,   // Recipient's wallet address
    DEFAULT_AMOUNT: process.env.DEFAULT_AMOUNT || '1000000'
  };
// Export using ES modules
export { AWS, AmazonCognitoIdentity, userPool,poolData, docClient, s3,aptosConfig};
