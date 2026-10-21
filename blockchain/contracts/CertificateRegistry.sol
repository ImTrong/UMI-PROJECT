// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CertificateRegistry
 * @notice Immutable registry for certificate document hashes on Polygon Amoy.
 * @dev Only the contract owner (system wallet) can register and revoke certificates.
 *      No PII or PDF content is stored on-chain — only cryptographic hashes.
 */
contract CertificateRegistry is Ownable {
    /// @notice Certificate validity status
    enum Status {
        NONE,    // 0 — not registered
        VALID,   // 1 — active certificate
        REVOKED  // 2 — revoked by admin
    }

    /// @notice On-chain certificate record
    struct CertificateRecord {
        bytes32 documentHash; // SHA-256 hash of the PDF file bytes
        uint64  issuedAt;     // Unix timestamp of certificate issuance
        Status  status;       // Current validity status
        address issuer;       // Wallet that registered this certificate
    }

    /// @dev certificateIdHash => CertificateRecord
    ///      certificateIdHash = keccak256(bytes(certificateNumber))
    mapping(bytes32 => CertificateRecord) private certificates;

    // ======================== Events ========================

    event CertificateRegistered(
        bytes32 indexed certificateIdHash,
        bytes32 documentHash,
        uint64  issuedAt
    );

    event CertificateRevoked(bytes32 indexed certificateIdHash);

    // ======================== Constructor ========================

    constructor() Ownable(msg.sender) {}

    // ======================== Write Functions ========================

    /**
     * @notice Register a new certificate's document hash on-chain.
     * @param certificateIdHash  keccak256(bytes(certificateNumber))
     * @param documentHash       SHA-256 hash of the PDF file bytes
     * @param issuedAt           Unix timestamp of certificate issuance
     */
    function registerCertificate(
        bytes32 certificateIdHash,
        bytes32 documentHash,
        uint64  issuedAt
    ) external onlyOwner {
        require(
            certificates[certificateIdHash].status == Status.NONE,
            "Certificate already registered"
        );
        require(documentHash != bytes32(0), "Document hash cannot be zero");

        certificates[certificateIdHash] = CertificateRecord({
            documentHash: documentHash,
            issuedAt: issuedAt,
            status: Status.VALID,
            issuer: msg.sender
        });

        emit CertificateRegistered(certificateIdHash, documentHash, issuedAt);
    }

    /**
     * @notice Revoke a previously registered certificate.
     * @param certificateIdHash  keccak256(bytes(certificateNumber))
     */
    function revokeCertificate(bytes32 certificateIdHash) external onlyOwner {
        require(
            certificates[certificateIdHash].status == Status.VALID,
            "Certificate not valid or not found"
        );

        certificates[certificateIdHash].status = Status.REVOKED;

        emit CertificateRevoked(certificateIdHash);
    }

    // ======================== Read Functions ========================

    /**
     * @notice Retrieve a certificate record from on-chain storage.
     * @param certificateIdHash  keccak256(bytes(certificateNumber))
     * @return documentHash  SHA-256 hash of the PDF
     * @return issuedAt      Unix timestamp
     * @return status        Certificate status (NONE / VALID / REVOKED)
     * @return issuer        Wallet address that registered the certificate
     */
    function getCertificate(bytes32 certificateIdHash)
        external
        view
        returns (
            bytes32 documentHash,
            uint64  issuedAt,
            Status  status,
            address issuer
        )
    {
        CertificateRecord storage cert = certificates[certificateIdHash];
        return (cert.documentHash, cert.issuedAt, cert.status, cert.issuer);
    }
}
