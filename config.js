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

// Export using ES modules
export { AWS, AmazonCognitoIdentity, userPool,poolData, docClient, s3};
