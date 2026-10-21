/**
 * Blockchain Configuration
 * 
 * Controls connection to Polygon Amoy testnet for certificate hash registration.
 * Feature-flagged via BLOCKCHAIN_ENABLED — defaults to false so UMI runs
 * normally without blockchain infrastructure.
 */

import logger from '../utils/logger';

export const BLOCKCHAIN_CONFIG = {
  /** Master switch — set to 'true' to enable blockchain registration */
  enabled: process.env.BLOCKCHAIN_ENABLED === 'true',

  /** Network identifier for metadata */
  network: process.env.BLOCKCHAIN_NETWORK || 'polygon-amoy',

  /** EVM chain ID */
  chainId: parseInt(process.env.BLOCKCHAIN_CHAIN_ID || '80002', 10),

  /** RPC endpoint (must use provider like Alchemy/Infura — NOT deprecated public RPC) */
  rpcUrl: process.env.BLOCKCHAIN_RPC_URL || '',

  /** System wallet private key (NEVER log, NEVER expose to frontend) */
  privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY || '',

  /** Deployed CertificateRegistry contract address */
  contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || '',

  /** Block explorer base URL */
  explorerUrl: 'https://amoy.polygonscan.com',
} as const;

/**
 * Validate that blockchain config is complete when enabled.
 * Called at service startup.
 */
export function validateBlockchainConfig(): boolean {
  if (!BLOCKCHAIN_CONFIG.enabled) {
    logger.info('⛓️  Blockchain certificate verification is DISABLED');
    return false;
  }

  const missing: string[] = [];
  if (!BLOCKCHAIN_CONFIG.rpcUrl) missing.push('BLOCKCHAIN_RPC_URL');
  if (!BLOCKCHAIN_CONFIG.privateKey) missing.push('BLOCKCHAIN_PRIVATE_KEY');
  if (!BLOCKCHAIN_CONFIG.contractAddress) missing.push('BLOCKCHAIN_CONTRACT_ADDRESS');

  if (missing.length > 0) {
    logger.error(`⛓️  Blockchain ENABLED but missing config: ${missing.join(', ')}`);
    logger.error('⛓️  Blockchain features will be disabled until configuration is complete');
    return false;
  }

  logger.info(`⛓️  Blockchain certificate verification ENABLED on ${BLOCKCHAIN_CONFIG.network} (chainId: ${BLOCKCHAIN_CONFIG.chainId})`);
  return true;
}
