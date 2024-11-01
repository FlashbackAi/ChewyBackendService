import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import AmazonCognitoIdentity from 'amazon-cognito-identity-js';

dotenv.config();

// First, set up AWS credentials from environment variables
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Configure AWS SDK v2
AWS.config.update({
  region: AWS_REGION,
  credentials: new AWS.Credentials({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  })
});

// Configure AWS SDK v3 client with credentials
const secretsClient = new SecretsManagerClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
});

let configData = {};

async function initializeConfig() {
  try {
    // Initialize basic AWS services first
    const dynamoDB = new AWS.DynamoDB({ region: AWS_REGION });
    const docClient = new AWS.DynamoDB.DocumentClient({ region: AWS_REGION });
    const s3 = new AWS.S3({ region: AWS_REGION });

    // Then fetch secrets
    const aptosConfig = await fetchAptosConfig();
    const cognitoConfig = await fetchCognitoSecrets();

    // Log configuration status (remove in production)
    console.log('Configuration status:', {
      aptosConfigPresent: aptosConfig ? 'yes' : 'no',
      cognitoConfigPresent: cognitoConfig ? 'yes' : 'no'
    });

    configData = {
      aws: {
        region: AWS_REGION,
        credentials: {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY
        }
      },
      aptos: aptosConfig,
      cognito: cognitoConfig,
      AWS,
      docClient,
      s3
    };
    
    return configData;
  } catch (error) {
    console.error('Error initializing config:', error);
    throw error;
  }
}

async function fetchCognitoSecrets() {
  const secretName = 'chewy_cognito_secrets';

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
        VersionStage: 'AWSCURRENT',
      })
    );

    const secrets = JSON.parse(response.SecretString);

    if (!secrets.COGNITO_USER_POOL_ID || !secrets.COGNITO_CLIENT_ID || !secrets.COGNITO_REGION) {
      throw new Error('Missing required Cognito secrets');
    }

    return {
      userPoolId: secrets.COGNITO_USER_POOL_ID,
      clientId: secrets.COGNITO_CLIENT_ID,
      region: secrets.COGNITO_REGION
    };
  } catch (error) {
    console.error('Error retrieving Cognito secrets:', error);
    throw error;
  }
}

async function fetchAptosConfig() {
  const secretName = 'chewy_aptos_secrets';

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
        VersionStage: 'AWSCURRENT',
      })
    );

    const secrets = JSON.parse(response.SecretString);

    return {
      SENDER_EMAIL: secrets.SENDER_EMAIL,
      APTOS_NODE_URL: secrets.APTOS_NODE_URL,
      SENDER_ADDRESS: secrets.SENDER_ADDRESS,
      SENDER_PRIVATE_KEY: secrets.SENDER_PRIVATE_KEY,
      RECIPIENT_ADDRESS: secrets.RECIPIENT_ADDRESS,
      DEFAULT_AMOUNT: process.env.DEFAULT_AMOUNT || '1000000'
    };
  } catch (error) {
    console.error('Error retrieving AWS secrets:', error);
    throw error;
  }
}

function getConfig() {
  if (!configData) {
    throw new Error('Config not initialized. Please call initializeConfig() first.');
  }
  return configData;
}

export {
  initializeConfig,
  getConfig,
  AWS,
  AmazonCognitoIdentity
};