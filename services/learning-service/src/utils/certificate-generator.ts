import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'path';
import logger from './logger';
import { minioInternalClient, BUCKETS } from '../config/minio.config';

export interface CertificateConfig {
  title?: string;
  subtitle?: string;
  description?: string;
  signerName?: string;
  signerTitle?: string;
  organizationName?: string;
  validityYears?: number;
  skills?: string[];
}

export interface CertificateData {
  certificateNumber: string;
  userName: string;
  courseTitle: string;
  issueDate: Date;
  verificationUrl: string;
  type?: 'COURSE_COMPLETION' | 'PATH_CERTIFICATE';
  certificateConfig?: CertificateConfig | null;
}

export class CertificateGenerator {
  static async generate(data: CertificateData): Promise<string> {
    try {
      const filename = `${data.certificateNumber}.pdf`;
      const isPathCert = data.type === 'PATH_CERTIFICATE';
      const config = data.certificateConfig || {};

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

      // Use custom title or default
      const certTitle = config.title || data.courseTitle;

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

        // Subtitle (custom or none)
        let currentY = 175;
        if (config.subtitle) {
          doc.font('Roboto').fontSize(14)
             .fillColor('#92400e')
             .text(config.subtitle, 0, 155, { align: 'center' });
          currentY = 185;
        }

        // Gold separator
        const lineGradGold = doc.linearGradient(centerX - 80, 0, centerX + 80, 0);
        lineGradGold.stop(0, '#f59e0b').stop(0.5, '#d97706').stop(1, '#f59e0b');
        doc.rect(centerX - 80, currentY, 160, 3).fill(lineGradGold);

        currentY += 35;
        doc.font('Roboto').fontSize(16)
           .fillColor('#78350f')
           .text('Chứng nhận rằng', 0, currentY, { align: 'center' });

        currentY += 40;
        doc.font('Roboto-Bold').fontSize(34)
           .fillColor('#92400e')
           .text(data.userName, 0, currentY, { align: 'center' });

        currentY += 60;
        doc.font('Roboto').fontSize(16)
           .fillColor('#78350f')
           .text('đã hoàn thành xuất sắc lộ trình học tập', 0, currentY, { align: 'center' });

        currentY += 40;
        doc.font('Roboto-Bold').fontSize(26)
           .fillColor('#451a03')
           .text(certTitle, 0, currentY, { align: 'center' });

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

        // Subtitle (custom or none)
        let currentY = 190;
        if (config.subtitle) {
          doc.font('Roboto').fontSize(13)
             .fillColor('#64748b')
             .text(config.subtitle, 0, 175, { align: 'center' });
          currentY = 200;
        }

        const lineGrad = doc.linearGradient(centerX - 50, 0, centerX + 50, 0);
        lineGrad.stop(0, '#38bdf8').stop(1, '#22d3ee');
        doc.rect(centerX - 50, currentY, 100, 3).fill(lineGrad);

        currentY += 40;
        doc.font('Roboto').fontSize(16)
           .fillColor('#64748b')
           .text('Chứng nhận rằng', 0, currentY, { align: 'center' });

        currentY += 40;
        doc.font('Roboto-Bold').fontSize(32)
           .fillColor('#0284c7')
           .text(data.userName, 0, currentY, { align: 'center' });

        currentY += 60;
        doc.font('Roboto').fontSize(16)
           .fillColor('#64748b')
           .text('đã hoàn thành xuất sắc khóa học', 0, currentY, { align: 'center' });

        currentY += 40;
        doc.font('Roboto-Bold').fontSize(24)
           .fillColor('#1e293b')
           .text(certTitle, 0, currentY, { align: 'center' });
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

      // Signer & organization section
      const signerY = 420;
      if (config.signerName || config.organizationName) {
        const signerNameColor = isPathCert ? '#451a03' : '#1e293b';
        const signerTitleColor = isPathCert ? '#78350f' : '#64748b';

        if (config.signerName) {
          // Signature line
          doc.moveTo(centerX - 80, signerY).lineTo(centerX + 80, signerY)
             .lineWidth(1).strokeColor(isPathCert ? '#d97706' : '#94a3b8').stroke();

          doc.font('Roboto-Bold').fontSize(14)
             .fillColor(signerNameColor)
             .text(config.signerName, 0, signerY + 8, { align: 'center' });
          
          if (config.signerTitle) {
            doc.font('Roboto').fontSize(11)
               .fillColor(signerTitleColor)
               .text(config.signerTitle, 0, signerY + 26, { align: 'center' });
          }
        }

        if (config.organizationName) {
          const orgY = config.signerName ? signerY + (config.signerTitle ? 44 : 30) : signerY + 8;
          doc.font('Roboto').fontSize(11)
             .fillColor(signerTitleColor)
             .text(config.organizationName, 0, orgY, { align: 'center' });
        }
      }

      // Date
      const dateY = (config.signerName || config.organizationName) ? 480 : 440;
      doc.font('Roboto').fontSize(14)
         .fillColor(dateColor)
         .text(`Ngày cấp: `, centerX - 60, dateY, { continued: true })
         .font('Roboto-Bold').fillColor(dateValueColor).text(dateStr);

      // Skills badges (if provided)
      if (config.skills && config.skills.length > 0) {
        const skillsY = dateY + 25;
        const skillsText = config.skills.join(' • ');
        doc.font('Roboto').fontSize(10)
           .fillColor(isPathCert ? '#92400e' : '#64748b')
           .text(`Kỹ năng: ${skillsText}`, 0, skillsY, { align: 'center' });
      }

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

