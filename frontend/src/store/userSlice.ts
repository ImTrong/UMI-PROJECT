import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { userService, UserProfile, Education, WorkExperience, UserStats } from '../services/user.service';
import { logout } from './authSlice';
import toast from 'react-hot-toast';

interface UserState {
  profile: UserProfile | null;
  stats: UserStats | null;
  loading: boolean;
  error: string | null;
}

const initialState: UserState = {
  profile: null,
  stats: null,
  loading: false,
  error: null,
};

// === Profile Thunks ===
export const fetchProfile = createAsyncThunk('user/fetchProfile', async () => {
  return await userService.getProfile();
});

export const updateProfile = createAsyncThunk(
  'user/updateProfile',
  async (data: Parameters<typeof userService.updateProfile>[0]) => {
    return await userService.updateProfile(data);
  }
);

export const deleteProfile = createAsyncThunk('user/deleteProfile', async () => {
  await userService.deleteProfile();
});

export const fetchUserStats = createAsyncThunk('user/fetchUserStats', async () => {
  return await userService.getUserStats();
});

// === Education Thunks ===
export const addEducation = createAsyncThunk(
  'user/addEducation',
  async (data: Parameters<typeof userService.addEducation>[0]) => {
    return await userService.addEducation(data);
  }
);

export const updateEducation = createAsyncThunk(
  'user/updateEducation',
  async ({ id, data }: { id: string; data: Partial<Parameters<typeof userService.addEducation>[0]> }) => {
    return await userService.updateEducation(id, data);
  }
);

export const deleteEducation = createAsyncThunk(
  'user/deleteEducation',
  async (id: string) => {
    await userService.deleteEducation(id);
    return id;
  }
);

// === Work Experience Thunks ===
export const addWorkExperience = createAsyncThunk(
  'user/addWorkExperience',
  async (data: Parameters<typeof userService.addWorkExperience>[0]) => {
    return await userService.addWorkExperience(data);
  }
);

export const updateWorkExperience = createAsyncThunk(
  'user/updateWorkExperience',
  async ({ id, data }: { id: string; data: Partial<Parameters<typeof userService.addWorkExperience>[0]> }) => {
    return await userService.updateWorkExperience(id, data);
  }
);

export const deleteWorkExperience = createAsyncThunk(
  'user/deleteWorkExperience',
  async (id: string) => {
    await userService.deleteWorkExperience(id);
    return id;
  }
);

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch Profile
      .addCase(fetchProfile.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProfile.fulfilled, (state, action: PayloadAction<UserProfile>) => {
        state.loading = false;
        state.profile = action.payload;
      })
      .addCase(fetchProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch profile';
      })
      // Update Profile
      .addCase(updateProfile.fulfilled, (state, action: PayloadAction<UserProfile>) => {
        state.profile = action.payload;
        toast.success('Profile updated successfully');
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to update profile';
        toast.error(state.error);
      })
      // Delete Profile
      .addCase(deleteProfile.fulfilled, (state) => {
        state.profile = null;
        toast.success('Account deleted successfully');
      })
      .addCase(deleteProfile.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to delete account');
      })
      // Fetch Stats
      .addCase(fetchUserStats.fulfilled, (state, action: PayloadAction<UserStats>) => {
        state.stats = action.payload;
      })
      // Add Education
      .addCase(addEducation.fulfilled, (state, action: PayloadAction<Education>) => {
        if (state.profile) {
          state.profile.education.push(action.payload);
        }
        toast.success('Education added successfully');
      })
      .addCase(addEducation.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to add education');
      })
      // Update Education
      .addCase(updateEducation.fulfilled, (state, action: PayloadAction<Education>) => {
        if (state.profile) {
          const idx = state.profile.education.findIndex(e => e.id === action.payload.id);
          if (idx !== -1) state.profile.education[idx] = action.payload;
        }
        toast.success('Education updated successfully');
      })
      .addCase(updateEducation.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to update education');
      })
      // Delete Education
      .addCase(deleteEducation.fulfilled, (state, action: PayloadAction<string>) => {
        if (state.profile) {
          state.profile.education = state.profile.education.filter(e => e.id !== action.payload);
        }
        toast.success('Education deleted successfully');
      })
      .addCase(deleteEducation.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to delete education');
      })
      // Add Work Experience
      .addCase(addWorkExperience.fulfilled, (state, action: PayloadAction<WorkExperience>) => {
        if (state.profile) {
          state.profile.work.push(action.payload);
        }
        toast.success('Work experience added successfully');
      })
      .addCase(addWorkExperience.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to add work experience');
      })
      // Update Work Experience
      .addCase(updateWorkExperience.fulfilled, (state, action: PayloadAction<WorkExperience>) => {
        if (state.profile) {
          const idx = state.profile.work.findIndex(w => w.id === action.payload.id);
          if (idx !== -1) state.profile.work[idx] = action.payload;
        }
        toast.success('Work experience updated successfully');
      })
      .addCase(updateWorkExperience.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to update work experience');
      })
      // Delete Work Experience
      .addCase(deleteWorkExperience.fulfilled, (state, action: PayloadAction<string>) => {
        if (state.profile) {
          state.profile.work = state.profile.work.filter(w => w.id !== action.payload);
        }
        toast.success('Work experience deleted successfully');
      })
      .addCase(deleteWorkExperience.rejected, (_, action) => {
        toast.error(action.error.message || 'Failed to delete work experience');
      })
      // Clear on logout
      .addCase(logout.pending, (state) => {
        state.profile = null;
        state.stats = null;
        state.error = null;
      });
  },
});

export const { clearError } = userSlice.actions;
export default userSlice.reducer;
