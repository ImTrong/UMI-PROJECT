import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'path';
import logger from './logger';
import { minioInternalClient, BUCKETS } from '../config/minio.config';

export interface CertificateData {
  certificateNumber: string;
  userName: string;
  courseTitle: string;
  issueDate: Date;
  verificationUrl: string;
  type?: 'COURSE_COMPLETION' | 'PATH_CERTIFICATE';
}

export class CertificateGenerator {
  static async generate(data: CertificateData): Promise<string> {
    try {
      const filename = `${data.certificateNumber}.pdf`;
      const isPathCert = data.type === 'PATH_CERTIFICATE';

      const qrCodeDataUrl = await QRCode.toDataURL(data.verificationUrl);
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
      
      const uploadPromise = new Promise<void>((resolve, reject) => {
        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
          try {
            const pdfData = Buffer.concat(buffers);
            await minioInternalClient.putObject(
              BUCKETS.CERTIFICATES, 
              filename, 
              pdfData, 
              undefined, 
              {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${filename}"`
              }
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        doc.on('error', reject);
      });

      // Register fonts
      const fontRegularPath = path.resolve(__dirname, '../../assets/fonts/Roboto-Regular.ttf');
      const fontBoldPath = path.resolve(__dirname, '../../assets/fonts/Roboto-Bold.ttf');
      
      doc.registerFont('Roboto', fontRegularPath);
      doc.registerFont('Roboto-Bold', fontBoldPath);

      const centerX = doc.page.width / 2;

      // Background
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');

      if (isPathCert) {
        // === PATH CERTIFICATE (Chứng chỉ) — More prestigious design ===
        
        // Gold top border
        const gradTopGold = doc.linearGradient(0, 0, doc.page.width, 0);
        gradTopGold.stop(0, '#b45309').stop(0.3, '#d97706').stop(0.5, '#f59e0b').stop(0.7, '#d97706').stop(1, '#b45309');
        doc.rect(0, 0, doc.page.width, 14).fill(gradTopGold);
        doc.rect(0, doc.page.height - 14, doc.page.width, 14).fill(gradTopGold);

        // Gold corner decorations
        doc.circle(0, 0, 180).fillOpacity(0.06).fill('#d97706');
        doc.circle(doc.page.width, 0, 180).fillOpacity(0.06).fill('#d97706');
        doc.circle(0, doc.page.height, 180).fillOpacity(0.06).fill('#d97706');
        doc.circle(doc.page.width, doc.page.height, 180).fillOpacity(0.06).fill('#d97706');
        doc.fillOpacity(1);

        // Inner border frame
        doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
           .lineWidth(2).strokeColor('#d97706').stroke();

        doc.font('Roboto-Bold').fontSize(13)
           .fillColor('#92400e')
           .text('CHỨNG CHỈ HOÀN THÀNH LỘ TRÌNH', 0, 80, { align: 'center', characterSpacing: 5 });

        doc.font('Roboto-Bold').fontSize(38)
           .fillColor('#78350f')
           .text('CERTIFICATE OF ACHIEVEMENT', 0, 110, { align: 'center' });

        // Gold separator
        const lineGradGold = doc.linearGradient(centerX - 80, 0, centerX + 80, 0);
        lineGradGold.stop(0, '#f59e0b').stop(0.5, '#d97706').stop(1, '#f59e0b');
        doc.rect(centerX - 80, 175, 160, 3).fill(lineGradGold);

        doc.font('Roboto').fontSize(16)
           .fillColor('#78350f')
           .text('Chứng nhận rằng', 0, 210, { align: 'center' });

        doc.font('Roboto-Bold').fontSize(34)
           .fillColor('#92400e')
           .text(data.userName, 0, 250, { align: 'center' });

        doc.font('Roboto').fontSize(16)
           .fillColor('#78350f')
           .text('đã hoàn thành xuất sắc lộ trình học tập', 0, 310, { align: 'center' });

        doc.font('Roboto-Bold').fontSize(26)
           .fillColor('#451a03')
           .text(data.courseTitle, 0, 350, { align: 'center' });

      } else {
        // === COURSE COMPLETION (Chứng nhận) — Original cyan/teal design ===
        
        const gradTop = doc.linearGradient(0, 0, doc.page.width, 0);
        gradTop.stop(0, '#0ea5e9').stop(0.5, '#06b6d4').stop(1, '#14b8a6');
        doc.rect(0, 0, doc.page.width, 12).fill(gradTop);
        doc.rect(0, doc.page.height - 12, doc.page.width, 12).fill(gradTop);

        doc.circle(0, 0, 200).fillOpacity(0.05).fill('#0ea5e9');
        doc.circle(doc.page.width, doc.page.height, 200).fillOpacity(0.05).fill('#06b6d4');
        doc.fillOpacity(1);

        doc.font('Roboto-Bold').fontSize(12)
           .fillColor('#94a3b8')
           .text('CHỨNG NHẬN HOÀN THÀNH KHÓA HỌC', 0, 100, { align: 'center', characterSpacing: 4 });
           
        doc.font('Roboto-Bold').fontSize(36)
           .fillColor('#1f2937')
           .text('CERTIFICATE OF COMPLETION', 0, 130, { align: 'center' });

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
      }
         
      // Date formatting (shared)
      const dateObj = new Date(data.issueDate);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      const dateStr = `${day}/${month}/${year}`;

      const dateColor = isPathCert ? '#78350f' : '#64748b';
      const dateValueColor = isPathCert ? '#451a03' : '#0f172a';
      const codeColor = isPathCert ? '#92400e' : '#94a3b8';

      doc.font('Roboto').fontSize(14)
         .fillColor(dateColor)
         .text(`Ngày cấp: `, centerX - 60, 440, { continued: true })
         .font('Roboto-Bold').fillColor(dateValueColor).text(dateStr);

      const codeLabel = isPathCert ? 'Mã chứng chỉ' : 'Mã chứng nhận';
      doc.font('Roboto').fontSize(12)
         .fillColor(codeColor)
         .text(`${codeLabel}: ${data.certificateNumber}`, 0, doc.page.height - 60, { align: 'center' });

      const qrImage = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
      doc.image(qrImage, doc.page.width - 120, doc.page.height - 120, { width: 80, height: 80 });

      doc.end();

      await uploadPromise;
      logger.info(`Certificate generated and uploaded to MinIO: ${filename}`);
      return filename;
    } catch (error) {
      logger.error('Certificate generation error:', error);
      throw new Error('Failed to generate certificate');
    }
  }

  static async deleteCertificate(filename: string): Promise<void> {
    try {
      await minioInternalClient.removeObject(BUCKETS.CERTIFICATES, filename);
      logger.info(`Certificate deleted from MinIO: ${filename}`);
    } catch (error) {
      logger.error('Certificate deletion error:', error);
    }
  }
}
