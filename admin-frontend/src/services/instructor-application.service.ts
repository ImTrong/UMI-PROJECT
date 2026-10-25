import { userApi as api } from './api';

// IMPLEMENT-01: instructor applications, reviewed by an ADMIN in the user-service (the reviewer is always the signed-in admin).
export type InstructorApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface InstructorApplication {
  id: string;
  userId: string;
  status: InstructorApplicationStatus;
  expertise: string;
  motivation: string | null;
  source: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  applicant: { userId: string; fullName: string; email: string; avatar?: string | null; role: string } | null;
}

export interface InstructorApplicationList {
  data: InstructorApplication[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const instructorApplicationService = {
  async list(status: InstructorApplicationStatus | '', page = 1, limit = 10): Promise<InstructorApplicationList> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set('status', status);
    const response = await api.get(`/api/users/admin/instructor-applications?${params.toString()}`);
    return response.data;
  },

  async approve(applicationId: string) {
    const response = await api.post(`/api/users/admin/instructor-applications/${applicationId}/approve`);
    return response.data.data;
  },

  async reject(applicationId: string, reason: string) {
    const response = await api.post(`/api/users/admin/instructor-applications/${applicationId}/reject`, { reason });
    return response.data.data;
  },
};
