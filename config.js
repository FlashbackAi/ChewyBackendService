import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import AmazonCognitoIdentity from 'amazon-cognito-identity-js';

dotenv.config();

// Set AWS region
AWS.config.update({ 
    region: 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Initialize AWS SDK Services
const rekognition = new AWS.Rekognition({ region: 'ap-south-1' });
const dynamoDB = new AWS.DynamoDB({ region: 'ap-south-1' });
const docClient = new AWS.DynamoDB.DocumentClient({ region: 'ap-south-1' });

// Amazon Cognito User Pool
const poolData = {
    UserPoolId: 'ap-south-1_rTy0HL6Gk',
    ClientId: '6goctqurrumilpurvtnh6s4fl1',
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

const s3 = new AWS.S3({ // accessKey and SecretKey is being fetched from config.js
    region: 'ap-south-1' // Update with your AWS region 
  });

// Export using ES modules
export { AWS, AmazonCognitoIdentity, userPool, docClient, rekognition, s3};
