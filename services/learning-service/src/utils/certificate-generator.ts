import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import logger from './logger';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export interface CertificateData {
  certificateNumber: string;
  userName: string;
  courseTitle: string;
  issueDate: Date;
  verificationUrl: string;
}

export class CertificateGenerator {
  private static storagePath = process.env.CERTIFICATE_STORAGE_PATH || './certificates';

  static async generate(data: CertificateData): Promise<string> {
    try {
      if (!fs.existsSync(this.storagePath)) {
        await mkdir(this.storagePath, { recursive: true });
      }

      const filename = `${data.certificateNumber}.pdf`;
      const filepath = path.join(this.storagePath, filename);

      const qrCodeDataUrl = await QRCode.toDataURL(data.verificationUrl);
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Background
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f5f5f5');
      doc.rect(40, 40, doc.page.width - 80, doc.page.height - 80).stroke('#4a90e2');

      // Title
      doc.fontSize(48)
        .font('Helvetica-Bold')
        .fillColor('#2c3e50')
        .text('CERTIFICATE OF COMPLETION', 0, 100, { align: 'center' });

      doc.fontSize(18)
        .font('Helvetica')
        .fillColor('#7f8c8d')
        .text('This certificate is awarded to', 0, 200, { align: 'center' });

      doc.fontSize(36)
        .font('Helvetica-Bold')
        .fillColor('#3498db')
        .text(data.userName, 0, 260, { align: 'center' });

      doc.fontSize(18)
        .font('Helvetica')
        .fillColor('#2c3e50')
        .text('for successfully completing the course', 0, 340, { align: 'center' });

      doc.fontSize(28)
        .font('Helvetica-Bold')
        .fillColor('#e74c3c')
        .text(data.courseTitle, 0, 400, { align: 'center' });

      doc.fontSize(12)
        .font('Helvetica')
        .fillColor('#7f8c8d')
        .text(`Issue Date: ${data.issueDate.toLocaleDateString()}`, 50, doc.page.height - 100);

      doc.fontSize(10)
        .text(`Certificate Number: ${data.certificateNumber}`, 50, doc.page.height - 80);

      const qrImage = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
      doc.image(qrImage, doc.page.width - 150, doc.page.height - 150, { width: 100, height: 100 });

      doc.fontSize(10).text('Authorized Signature', doc.page.width - 200, doc.page.height - 50);
      doc.end();

      await new Promise<void>((resolve) => stream.on('finish', () => resolve()));
      logger.info(`Certificate generated: ${filename}`);
      return filepath;
    } catch (error) {
      logger.error('Certificate generation error:', error);
      throw new Error('Failed to generate certificate');
    }
  }

  static async deleteCertificate(filepath: string): Promise<void> {
    try {
      if (fs.existsSync(filepath)) {
        await fs.promises.unlink(filepath);
        logger.info(`Certificate deleted: ${filepath}`);
      }
    } catch (error) {
      logger.error('Certificate deletion error:', error);
    }
  }
}
