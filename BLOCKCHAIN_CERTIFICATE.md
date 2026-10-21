# Blockchain Certificate Verification — UMI E-learning

## 🚀 Live Deployment (Polygon Amoy Testnet)

| Parameter | Value |
|-----------|-------|
| **Network** | Polygon Amoy Testnet |
| **Chain ID** | 80002 |
| **Contract Address** | [`0x434f13D092C09E22905Fe82708CAAf99C71C2d79`](https://amoy.polygonscan.com/address/0x434f13D092C09E22905Fe82708CAAf99C71C2d79) |
| **Deployment TX** | [`0x0cc93c855dafba81a7bd8a334cd0e0ca7318d9927737330c961489c6f69b67a1`](https://amoy.polygonscan.com/tx/0x0cc93c855dafba81a7bd8a334cd0e0ca7318d9927737330c961489c6f69b67a1) |
| **Deployer** | `0xa809a2266ab00Ebba4F90B608faa60AfAfbB1AE0` |
| **Deployed At** | 2026-09-27T03:09:01.950Z |
| **Solidity** | 0.8.20 |

### E2E Test Results (2026-09-27)

| # | Test | Result |
|---|------|--------|
| 1 | Contract Owner | ✅ PASS |
| 2 | Register Certificate | ✅ PASS |
| 3 | Read On-Chain Data | ✅ PASS |
| 3b | No PII On-Chain | ✅ PASS |
| 4 | Hash Verify (same PDF) | ✅ PASS |
| 5 | Tamper Detection | ✅ PASS |
| 6 | Duplicate Rejected | ✅ PASS |
| 7 | Revoke Certificate | ✅ PASS |
| 8 | Post-Revoke Status | ✅ PASS |
| 9 | Re-Revoke Rejected | ✅ PASS |
| 10 | Unregistered = NONE | ✅ PASS |
| 11 | Explorer URLs | ✅ PASS |

**Total: 12/12 PASSED**

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     UMI E-learning System                    │
│                                                             │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────┐ │
│  │   Frontend    │    │ learning-service │    │   MinIO   │ │
│  │              │◄──►│                  │◄──►│  (PDFs)   │ │
│  │ CertVerify   │    │ CertificateService│   └───────────┘ │
│  │ CertDetail   │    │ BlockchainService │                  │
│  └──────────────┘    │ RetryJob          │                  │
│                      └────────┬─────────┘                  │
│                               │                             │
│                               ▼                             │
│                      ┌────────────────┐                     │
│                      │  Polygon Amoy  │                     │
│                      │   (Testnet)    │                     │
│                      │                │                     │
│                      │ CertificateRegistry.sol              │
│                      └────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

## 2. Polygon Amoy Configuration

| Parameter | Value |
|-----------|-------|
| Network | Polygon Amoy Testnet |
| Chain ID | 80002 |
| Explorer | https://amoy.polygonscan.com/ |
| RPC | Via provider (Alchemy/Infura/QuickNode) |

> **WARNING**: The public RPC `rpc-amoy.polygon.technology` was deprecated by Polygon on 17/07/2026. Always use a private RPC provider via `BLOCKCHAIN_RPC_URL`.

## 3. Smart Contract

**Contract**: `CertificateRegistry.sol`
**Standard**: Solidity 0.8.20, OpenZeppelin Ownable
**Location**: `/blockchain/contracts/CertificateRegistry.sol`

### Functions

| Function | Access | Description |
|----------|--------|-------------|
| `registerCertificate(bytes32 certIdHash, bytes32 docHash, uint64 issuedAt)` | onlyOwner | Register a certificate hash |
| `revokeCertificate(bytes32 certIdHash)` | onlyOwner | Revoke a registered certificate |
| `getCertificate(bytes32 certIdHash)` | public/view | Read certificate record |

### Events

- `CertificateRegistered(bytes32 indexed certificateIdHash, bytes32 documentHash, uint64 issuedAt)`
- `CertificateRevoked(bytes32 indexed certificateIdHash)`

## 4. Data Stored On-chain

| Field | Type | Description |
|-------|------|-------------|
| `documentHash` | bytes32 | SHA-256 hash of PDF file bytes |
| `issuedAt` | uint64 | Unix timestamp of certificate issuance |
| `status` | uint8 | 0=NONE, 1=VALID, 2=REVOKED |
| `issuer` | address | Wallet that registered the certificate |

**NOT stored on-chain**: PDF file, userName, email, phone, personal information, certificate metadata.

## 5. Data Stored Off-chain (MongoDB)

Blockchain metadata is stored in the existing `metadata` JSON field of the Certificate model:

```json
{
  "blockchain": {
    "network": "polygon-amoy",
    "chainId": 80002,
    "contractAddress": "0x...",
    "certificateIdHash": "0x...",
    "documentHash": "0x...",
    "transactionHash": "0x...",
    "status": "CONFIRMED",
    "registeredAt": "2026-09-23T..."
  }
}
```

### Blockchain Status Values

| Status | Description |
|--------|-------------|
| `NOT_REGISTERED` | Legacy certificate, no blockchain registration |
| `PENDING` | Registration submitted, awaiting confirmation |
| `CONFIRMED` | Transaction confirmed on blockchain |
| `FAILED` | Registration failed (will be retried) |
| `REVOKED` | Revoked on both blockchain and DB |
| `REVOKE_PENDING` | Revocation submitted, awaiting confirmation |
| `REVOKE_FAILED` | Revocation failed (admin can retry) |

## 6. Hashing Process

```
Certificate PDF (exact bytes from PDFKit)
    ↓
SHA-256 (Node.js crypto module)
    ↓
0x-prefixed hex string (documentHash)
    ↓
Stored on-chain as bytes32
```

**Key guarantee**: The same `pdfBuffer` that is uploaded to MinIO is hashed. The PDF is never regenerated between hashing and uploading.

**Certificate ID on-chain**: `keccak256(bytes(certificateNumber))` — the plain-text certificateNumber is NOT stored on-chain.

## 7. Verification Flow

```
User opens /verify-certificate/:certificateNumber
    ↓
API: GET /api/learning/certificates/verify/:certificateNumber
    ↓
1. Find certificate in MongoDB
    ↓
2. Check isVerified (not revoked)
    ↓
3. Check expiresAt (not expired)
    ↓
4. If blockchain.status === CONFIRMED:
    a. Download PDF from MinIO
    b. SHA-256 hash current PDF bytes
    c. Read on-chain record via smart contract
    d. Compare current hash with on-chain documentHash
    ↓
5. Return verification result:
   - valid: true/false
   - blockchain.verified: true/false
   - blockchain.explorerUrl: link to Polygonscan
```

### Verification Cases

| DB Status | Blockchain Status | Hash Match | Result |
|-----------|------------------|------------|--------|
| isVerified=true | CONFIRMED | Match | ✅ VALID + BLOCKCHAIN VERIFIED |
| isVerified=true | CONFIRMED | Mismatch | ⚠️ Valid but Integrity Failed |
| isVerified=false | REVOKED | — | ❌ Certificate Revoked |
| expiresAt < now | — | — | ❌ Certificate Expired |
| isVerified=true | PENDING | — | ✅ Valid (awaiting blockchain) |
| isVerified=true | FAILED | — | ✅ Valid (blockchain failed) |
| isVerified=true | (none) | — | ✅ Valid (legacy certificate) |

## 8. Revoke Flow

**Blockchain-first approach** — DB is only updated after blockchain confirms.

```
Admin calls PATCH /api/learning/certificates/:id/revoke
    ↓
Set blockchain.status = REVOKE_PENDING (DB isVerified stays true)
    ↓
Call smart contract revokeCertificate()
    ↓
Wait for transaction confirmation
    ↓
[If confirmed]
    → Update isVerified = false in DB
    → Save revokeTransactionHash
    → blockchain.status = REVOKED
    ↓
[If failed]
    → Keep isVerified = true
    → blockchain.status = REVOKE_FAILED
    → Admin can retry
```

## 9. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BLOCKCHAIN_ENABLED` | No | `false` | Master switch |
| `BLOCKCHAIN_NETWORK` | No | `polygon-amoy` | Network name |
| `BLOCKCHAIN_CHAIN_ID` | No | `80002` | EVM chain ID |
| `BLOCKCHAIN_RPC_URL` | Yes* | — | RPC endpoint (Alchemy/Infura) |
| `BLOCKCHAIN_PRIVATE_KEY` | Yes* | — | System wallet private key |
| `BLOCKCHAIN_CONTRACT_ADDRESS` | Yes* | — | Deployed contract address |

*Required only when `BLOCKCHAIN_ENABLED=true`

> **SECURITY**: Private key must NEVER be committed to Git, logged, or sent to frontend. The `.env` file is already in `.gitignore`.

## 10. Deployment Steps

### Smart Contract

```bash
cd blockchain
npm install
npx hardhat compile
npx hardhat test

# Deploy to Polygon Amoy (requires BLOCKCHAIN_RPC_URL and BLOCKCHAIN_PRIVATE_KEY in .env)
npx hardhat run scripts/deploy.ts --network amoy

# Verify on Polygonscan (optional)
npx hardhat verify --network amoy <CONTRACT_ADDRESS>
```

### Backend

```bash
cd services/learning-service
npm install  # ethers@6 already added

# Set environment variables
BLOCKCHAIN_ENABLED=true
BLOCKCHAIN_RPC_URL=<your-rpc-url>
BLOCKCHAIN_PRIVATE_KEY=<your-private-key>
BLOCKCHAIN_CONTRACT_ADDRESS=<deployed-address>
```

## 11. Testing

### Smart Contract Tests (8 cases)

```bash
cd blockchain && npx hardhat test
```

1. Register certificate successfully
2. Cannot register duplicate certificate
3. Non-owner cannot register
4. Read certificate correctly
5. Owner can revoke
6. Non-owner cannot revoke
7. Cannot revoke non-existent certificate
8. Events are emitted correctly

### Integration Test Flows

**Flow 1**: Generate Certificate → PDF → Hash → Blockchain → Verify = Blockchain Verified
**Flow 2**: Modify PDF in MinIO → Verify → Hash Mismatch → blockchainVerified = false
**Flow 3**: Admin Revoke → Blockchain Revoke → DB Revoke → Verification = Revoked
**Flow 4**: BLOCKCHAIN_ENABLED=false → All flows work without blockchain

### TypeScript Check

```bash
cd services/learning-service && npx tsc --noEmit
```

## 12. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Private key exposure | Only in .env (gitignored), never in code/logs/frontend |
| PII on blockchain | Only hashes stored — no names, emails, or PDF content |
| Unauthorized registration | Smart contract uses `onlyOwner` modifier |
| Hash tampering | SHA-256 is cryptographic; PDF integrity verifiable |
| Frontend key access | Frontend has NO access to private key or signing |
| Blockchain unavailability | Feature flag allows graceful degradation |
| RPC rate limits | Retry job processes max 10 per cycle |
