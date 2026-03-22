export interface UserProfile {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  bio?: string;
  avatar?: string;
  role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';
  phoneNumber?: string;
  dateOfBirth?: Date;
  address?: string;
  city?: string;
  country?: string;
  badges: Badge[];
  preferences?: Preferences;
  education: EducationBackground[];
  workExperience: WorkExperience[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EducationBackground {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: Date;
  endDate?: Date;
  grade?: string;
  description?: string;
}

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  startDate: Date;
  endDate?: Date;
  current: boolean;
  description?: string;
}

export interface Badge {
  name: string;
  description?: string;
  awardedAt: Date;
  icon?: string;
}

export interface Preferences {
  emailNotifications: boolean;
  language: string;
  theme: string;
}

export interface CreateUserDTO {
  userId: string;
  email: string;
  fullName: string;
  role?: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';
}

export interface UpdateUserDTO {
  fullName?: string;
  bio?: string;
  avatar?: string;
  phoneNumber?: string;
  dateOfBirth?: Date;
  address?: string;
  city?: string;
  country?: string;
}

export interface AddEducationDTO {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: Date;
  endDate?: Date;
  grade?: string;
  description?: string;
}

export interface AddWorkExperienceDTO {
  company: string;
  position: string;
  startDate: Date;
  endDate?: Date;
  current?: boolean;
  description?: string;
}

export interface UpdatePreferencesDTO {
  emailNotifications?: boolean;
  language?: string;
  theme?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}
