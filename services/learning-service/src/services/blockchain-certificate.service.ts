/**
 * BlockchainCertificateService
 * 
 * Handles all interactions between learning-service and the CertificateRegistry
 * smart contract on Polygon Amoy.
 * 
 * Responsibilities:
 * - SHA-256 hash PDF bytes
 * - keccak256 hash certificateNumber for on-chain key
 * - Register/revoke certificate hashes on blockchain
 * - Read on-chain records for verification
 * - Compare document hashes for integrity checks
 */

import { ethers, JsonRpcProvider, Wallet, Contract } from 'ethers';
import crypto from 'crypto';
import { BLOCKCHAIN_CONFIG } from '../config/blockchain.config';
import contractABI from '../config/CertificateRegistry.abi.json';
import logger from '../utils/logger';
import { BlockchainMetadata, BlockchainStatus } from '../types';

export class BlockchainCertificateService {
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private contract: Contract | null = null;
  private readOnlyContract: Contract | null = null;
  private initialized = false;

  /**
   * Lazy initialization — only connects when actually needed.
   */
  private initialize(): boolean {
    if (this.initialized) return true;
    if (!BLOCKCHAIN_CONFIG.enabled) return false;

    try {
      this.provider = new JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl, {
        name: BLOCKCHAIN_CONFIG.network,
        chainId: BLOCKCHAIN_CONFIG.chainId,
      });

      this.wallet = new Wallet(BLOCKCHAIN_CONFIG.privateKey, this.provider);

      // Write contract (uses wallet for signing transactions)
      this.contract = new Contract(
        BLOCKCHAIN_CONFIG.contractAddress,
        contractABI,
        this.wallet
      );

      // Read-only contract (no wallet needed)
      this.readOnlyContract = new Contract(
        BLOCKCHAIN_CONFIG.contractAddress,
        contractABI,
        this.provider
      );

      this.initialized = true;
      logger.info('⛓️  BlockchainCertificateService initialized');
      return true;
    } catch (error) {
      logger.error('⛓️  Failed to initialize BlockchainCertificateService:', error);
      return false;
    }
  }

  /**
   * Check if blockchain features are enabled and configured.
   */
  isEnabled(): boolean {
    return BLOCKCHAIN_CONFIG.enabled && this.initialize();
  }

  // ======================== Hashing ========================

  /**
   * Create SHA-256 hash from PDF file bytes.
   * This is a cryptographic hash — NOT a digital signature.
   * 
   * @param pdfBuffer Raw bytes of the PDF file
   * @returns 0x-prefixed hex string of the SHA-256 hash
   */
  hashPdfBuffer(pdfBuffer: Buffer): string {
    const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    return `0x${hash}`;
  }

  /**
   * Create keccak256 hash from certificateNumber for on-chain lookup key.
   * 
   * @param certificateNumber The certificate number (e.g., "CERT-1727100000-abc123-de45-XYZ123")
   * @returns bytes32 hex string
   */
  hashCertificateId(certificateNumber: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(certificateNumber));
  }

  // ======================== Write Operations ========================

  /**
   * Register a certificate's document hash on the blockchain.
   * 
   * @param certificateNumber Human-readable certificate number
   * @param documentHash SHA-256 hash of PDF bytes (0x-prefixed)
   * @param issuedAt Date the certificate was issued
   * @returns Transaction hash or null on failure
   */
  async registerCertificate(
    certificateNumber: string,
    documentHash: string,
    issuedAt: Date
  ): Promise<{ transactionHash: string; certificateIdHash: string } | null> {
    if (!this.isEnabled() || !this.contract) {
      logger.warn('⛓️  Blockchain not enabled, skipping registration');
      return null;
    }

    try {
      const certificateIdHash = this.hashCertificateId(certificateNumber);
      const issuedAtTimestamp = BigInt(Math.floor(issuedAt.getTime() / 1000));

      logger.info(`⛓️  Registering certificate ${certificateNumber} on blockchain...`);

      const tx = await this.contract.registerCertificate(
        certificateIdHash,
        documentHash,
        issuedAtTimestamp
      );

      logger.info(`⛓️  Transaction sent: ${tx.hash}`);

      // Wait for 1 confirmation
      const receipt = await tx.wait(1);
      logger.info(`⛓️  Transaction confirmed in block ${receipt.blockNumber}`);

      return {
        transactionHash: tx.hash,
        certificateIdHash,
      };
    } catch (error: any) {
      logger.error(`⛓️  Blockchain registration failed for ${certificateNumber}:`, error.message);
      return null;
    }
  }

  /**
   * Revoke a certificate on the blockchain.
   * This is called BEFORE updating DB — blockchain-first approach.
   * 
   * @param certificateNumber Human-readable certificate number
   * @returns Transaction hash or null on failure
   */
  async revokeCertificate(
    certificateNumber: string
  ): Promise<{ transactionHash: string } | null> {
    if (!this.isEnabled() || !this.contract) {
      logger.warn('⛓️  Blockchain not enabled, skipping revocation');
      return null;
    }

    try {
      const certificateIdHash = this.hashCertificateId(certificateNumber);

      logger.info(`⛓️  Revoking certificate ${certificateNumber} on blockchain...`);

      const tx = await this.contract.revokeCertificate(certificateIdHash);
      logger.info(`⛓️  Revoke transaction sent: ${tx.hash}`);

      const receipt = await tx.wait(1);
      logger.info(`⛓️  Revoke confirmed in block ${receipt.blockNumber}`);

      return { transactionHash: tx.hash };
    } catch (error: any) {
      logger.error(`⛓️  Blockchain revocation failed for ${certificateNumber}:`, error.message);
      return null;
    }
  }

  // ======================== Read Operations ========================

  /**
   * Read a certificate record from the blockchain.
   * Uses read-only provider (no gas cost).
   */
  async getCertificateOnChain(certificateNumber: string): Promise<{
    documentHash: string;
    issuedAt: number;
    status: number; // 0=NONE, 1=VALID, 2=REVOKED
    issuer: string;
  } | null> {
    if (!this.isEnabled() || !this.readOnlyContract) {
      return null;
    }

    try {
      const certificateIdHash = this.hashCertificateId(certificateNumber);
      const [documentHash, issuedAt, status, issuer] =
        await this.readOnlyContract.getCertificate(certificateIdHash);

      return {
        documentHash: documentHash as string,
        issuedAt: Number(issuedAt),
        status: Number(status),
        issuer: issuer as string,
      };
    } catch (error: any) {
      logger.error(`⛓️  Failed to read certificate on-chain:`, error.message);
      return null;
    }
  }

  /**
   * Verify document integrity by comparing current PDF hash with on-chain hash.
   * 
   * @param certificateNumber Certificate number for on-chain lookup
   * @param pdfBuffer Current PDF bytes from MinIO
   * @returns Verification result
   */
  async verifyDocumentIntegrity(
    certificateNumber: string,
    pdfBuffer: Buffer
  ): Promise<{
    verified: boolean;
    onChainHash: string | null;
    currentHash: string;
    onChainStatus: number | null; // 0=NONE, 1=VALID, 2=REVOKED
  }> {
    const currentHash = this.hashPdfBuffer(pdfBuffer);

    if (!this.isEnabled()) {
      return {
        verified: false,
        onChainHash: null,
        currentHash,
        onChainStatus: null,
      };
    }

    try {
      const onChainRecord = await this.getCertificateOnChain(certificateNumber);

      if (!onChainRecord || onChainRecord.status === 0) {
        // Not registered on blockchain
        return {
          verified: false,
          onChainHash: null,
          currentHash,
          onChainStatus: onChainRecord?.status ?? null,
        };
      }

      const verified = onChainRecord.documentHash === currentHash;

      return {
        verified,
        onChainHash: onChainRecord.documentHash,
        currentHash,
        onChainStatus: onChainRecord.status,
      };
    } catch (error: any) {
      logger.error('⛓️  Document integrity verification failed:', error.message);
      return {
        verified: false,
        onChainHash: null,
        currentHash,
        onChainStatus: null,
      };
    }
  }

  // ======================== Metadata Helpers ========================

  /**
   * Create initial blockchain metadata for a newly generated certificate.
   */
  createPendingMetadata(certificateNumber: string, documentHash: string): BlockchainMetadata {
    return {
      network: BLOCKCHAIN_CONFIG.network,
      chainId: BLOCKCHAIN_CONFIG.chainId,
      contractAddress: BLOCKCHAIN_CONFIG.contractAddress,
      certificateIdHash: this.hashCertificateId(certificateNumber),
      documentHash,
      status: 'PENDING' as BlockchainStatus,
      registeredAt: new Date().toISOString(),
    };
  }

  /**
   * Get explorer URL for a transaction.
   */
  getExplorerUrl(transactionHash: string): string {
    return `${BLOCKCHAIN_CONFIG.explorerUrl}/tx/${transactionHash}`;
  }
}

// Singleton instance
export const blockchainCertificateService = new BlockchainCertificateService();
