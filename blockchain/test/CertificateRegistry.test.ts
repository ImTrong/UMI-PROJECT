import { expect } from "chai";
import { ethers } from "hardhat";
import { CertificateRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CertificateRegistry", function () {
  let registry: CertificateRegistry;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // Sample test data
  const certIdHash = ethers.keccak256(ethers.toUtf8Bytes("CERT-1727100000-abc123-de45-XYZ123"));
  const documentHash = ethers.sha256(ethers.toUtf8Bytes("sample-pdf-content-bytes"));
  const issuedAt = 1727100000n; // Unix timestamp

  beforeEach(async function () {
    [owner, nonOwner] = await ethers.getSigners();
    const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
    registry = await CertificateRegistryFactory.deploy();
    await registry.waitForDeployment();
  });

  // ========== Test 1: Register certificate successfully ==========
  it("should register a certificate successfully", async function () {
    await registry.registerCertificate(certIdHash, documentHash, issuedAt);

    const [docHash, issued, status, issuer] = await registry.getCertificate(certIdHash);
    expect(docHash).to.equal(documentHash);
    expect(issued).to.equal(issuedAt);
    expect(status).to.equal(1n); // Status.VALID
    expect(issuer).to.equal(owner.address);
  });

  // ========== Test 2: Cannot register duplicate certificate ==========
  it("should reject duplicate certificate registration", async function () {
    await registry.registerCertificate(certIdHash, documentHash, issuedAt);

    await expect(
      registry.registerCertificate(certIdHash, documentHash, issuedAt)
    ).to.be.revertedWith("Certificate already registered");
  });

  // ========== Test 3: Non-owner cannot register ==========
  it("should reject registration from non-owner", async function () {
    await expect(
      registry.connect(nonOwner).registerCertificate(certIdHash, documentHash, issuedAt)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  // ========== Test 4: Read certificate correctly ==========
  it("should read certificate data correctly", async function () {
    await registry.registerCertificate(certIdHash, documentHash, issuedAt);

    const [docHash, issued, status, issuer] = await registry.getCertificate(certIdHash);
    expect(docHash).to.equal(documentHash);
    expect(issued).to.equal(issuedAt);
    expect(status).to.equal(1n); // VALID
    expect(issuer).to.equal(owner.address);
  });

  // ========== Test 5: Owner can revoke ==========
  it("should allow owner to revoke a valid certificate", async function () {
    await registry.registerCertificate(certIdHash, documentHash, issuedAt);
    await registry.revokeCertificate(certIdHash);

    const [, , status] = await registry.getCertificate(certIdHash);
    expect(status).to.equal(2n); // Status.REVOKED
  });

  // ========== Test 6: Non-owner cannot revoke ==========
  it("should reject revocation from non-owner", async function () {
    await registry.registerCertificate(certIdHash, documentHash, issuedAt);

    await expect(
      registry.connect(nonOwner).revokeCertificate(certIdHash)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  // ========== Test 7: Cannot revoke non-existent certificate ==========
  it("should reject revocation of non-existent certificate", async function () {
    const fakeCertIdHash = ethers.keccak256(ethers.toUtf8Bytes("NON-EXISTENT-CERT"));

    await expect(
      registry.revokeCertificate(fakeCertIdHash)
    ).to.be.revertedWith("Certificate not valid or not found");
  });

  // ========== Test 8: Events are emitted correctly ==========
  it("should emit CertificateRegistered event on registration", async function () {
    await expect(registry.registerCertificate(certIdHash, documentHash, issuedAt))
      .to.emit(registry, "CertificateRegistered")
      .withArgs(certIdHash, documentHash, issuedAt);
  });

  it("should emit CertificateRevoked event on revocation", async function () {
    await registry.registerCertificate(certIdHash, documentHash, issuedAt);

    await expect(registry.revokeCertificate(certIdHash))
      .to.emit(registry, "CertificateRevoked")
      .withArgs(certIdHash);
  });

  // ========== Additional edge case: zero document hash ==========
  it("should reject registration with zero document hash", async function () {
    const zeroHash = ethers.ZeroHash;

    await expect(
      registry.registerCertificate(certIdHash, zeroHash, issuedAt)
    ).to.be.revertedWith("Document hash cannot be zero");
  });

  // ========== Additional: non-existent certificate returns NONE ==========
  it("should return NONE status for unregistered certificate", async function () {
    const fakeCertIdHash = ethers.keccak256(ethers.toUtf8Bytes("UNREGISTERED"));
    const [docHash, issued, status, issuer] = await registry.getCertificate(fakeCertIdHash);

    expect(docHash).to.equal(ethers.ZeroHash);
    expect(issued).to.equal(0n);
    expect(status).to.equal(0n); // Status.NONE
    expect(issuer).to.equal(ethers.ZeroAddress);
  });
});
