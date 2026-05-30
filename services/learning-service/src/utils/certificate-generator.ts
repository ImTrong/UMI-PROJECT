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

      // Register fonts
      const fontRegularPath = path.resolve(__dirname, '../../assets/fonts/Roboto-Regular.ttf');
      const fontBoldPath = path.resolve(__dirname, '../../assets/fonts/Roboto-Bold.ttf');
      
      doc.registerFont('Roboto', fontRegularPath);
      doc.registerFont('Roboto-Bold', fontBoldPath);

      const centerX = doc.page.width / 2;

      // Background
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
      
      // Top decorative border (Gradient from primary-500 to teal-500)
      const gradTop = doc.linearGradient(0, 0, doc.page.width, 0);
      gradTop.stop(0, '#0ea5e9').stop(0.5, '#06b6d4').stop(1, '#14b8a6');
      doc.rect(0, 0, doc.page.width, 12).fill(gradTop);
      
      // Bottom decorative border
      doc.rect(0, doc.page.height - 12, doc.page.width, 12).fill(gradTop);

      // Background decorations
      doc.circle(0, 0, 200).fillOpacity(0.05).fill('#0ea5e9');
      doc.circle(doc.page.width, doc.page.height, 200).fillOpacity(0.05).fill('#06b6d4');
      doc.fillOpacity(1);

      // "Chứng nhận hoàn thành"
      doc.font('Roboto-Bold').fontSize(12)
         .fillColor('#94a3b8')
         .text('CHỨNG NHẬN HOÀN THÀNH', 0, 100, { align: 'center', characterSpacing: 4 });
         
      // Title
      doc.font('Roboto-Bold').fontSize(36)
         .fillColor('#1f2937')
         .text('CERTIFICATE OF COMPLETION', 0, 130, { align: 'center' });

      // Line separator
      const lineGrad = doc.linearGradient(centerX - 50, 0, centerX + 50, 0);
      lineGrad.stop(0, '#38bdf8').stop(1, '#22d3ee');
      doc.rect(centerX - 50, 190, 100, 3).fill(lineGrad);

      doc.font('Roboto').fontSize(16)
         .fillColor('#64748b')
         .text('Chứng nhận rằng', 0, 230, { align: 'center' });

      doc.font('Roboto-Bold').fontSize(32)
         .fillColor('#0284c7')
         .text(data.userName, 0, 270, { align: 'center' });

      doc.font('Roboto').fontSize(16)
         .fillColor('#64748b')
         .text('đã hoàn thành xuất sắc khóa học', 0, 330, { align: 'center' });

      doc.font('Roboto-Bold').fontSize(24)
         .fillColor('#1e293b')
         .text(data.courseTitle, 0, 370, { align: 'center' });
         
      // Date formatting
      const dateObj = new Date(data.issueDate);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      const dateStr = `${day}/${month}/${year}`;

      doc.font('Roboto').fontSize(14)
         .fillColor('#64748b')
         .text(`Ngày cấp: `, centerX - 60, 440, { continued: true })
         .font('Roboto-Bold').fillColor('#0f172a').text(dateStr);

      doc.font('Roboto').fontSize(12)
         .fillColor('#94a3b8')
         .text(`Mã chứng chỉ: ${data.certificateNumber}`, 0, doc.page.height - 60, { align: 'center' });

      const qrImage = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
      doc.image(qrImage, doc.page.width - 120, doc.page.height - 120, { width: 80, height: 80 });

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
