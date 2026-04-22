import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { authService, AuthResponse } from '../services/auth.service';
import { userService } from '../services/user.service';
import toast from 'react-hot-toast';

interface AuthState {
  user: AuthResponse['user'] | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  loading: false,
  error: null,
};

export const login = createAsyncThunk(
  'auth/login',
  async ({ email, password }: { email: string; password: string }) => {
    const response = await authService.login({ email, password });
    // Store tokens first so the profile request is authenticated
    localStorage.setItem('accessToken', response.accessToken);
    localStorage.setItem('refreshToken', response.refreshToken);
    
    // Fetch user profile from user-service to get the role
    let role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' = 'STUDENT';
    try {
      const profile = await userService.getProfile();
      role = profile.role;
    } catch {
      // If profile doesn't exist yet, infer from email
      if (email.includes('admin')) role = 'ADMIN';
      else if (email.includes('instructor')) role = 'INSTRUCTOR';
    }
    
    return {
      ...response,
      user: { ...response.user, role },
    };
  }
);

export const register = createAsyncThunk(
  'auth/register',
  async ({ email, password, fullName }: { email: string; password: string; fullName: string }) => {
    const response = await authService.register({ email, password, fullName });
    return {
      ...response,
      user: { ...response.user, role: 'STUDENT' as const },
    };
  }
);

export const logout = createAsyncThunk('auth/logout', async () => {
  await authService.logout();
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    updateUser: (state, action: PayloadAction<Partial<AuthState['user']>>) => {
      if (state.user) {
        state.user = { ...state.user, ...action.payload } as any;
        localStorage.setItem('user', JSON.stringify(state.user));
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Login
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<AuthResponse & { user: AuthResponse['user'] & { role: string } }>) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.user = action.payload.user;
        localStorage.setItem('accessToken', action.payload.accessToken);
        localStorage.setItem('refreshToken', action.payload.refreshToken);
        localStorage.setItem('user', JSON.stringify(action.payload.user));
        toast.success(action.payload.message);
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Login failed';
        toast.error(state.error);
      })
      // Register
      .addCase(register.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(register.fulfilled, (state, action: PayloadAction<AuthResponse & { user: AuthResponse['user'] & { role: string } }>) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.user = action.payload.user;
        localStorage.setItem('accessToken', action.payload.accessToken);
        localStorage.setItem('refreshToken', action.payload.refreshToken);
        localStorage.setItem('user', JSON.stringify(action.payload.user));
        toast.success(action.payload.message);
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Registration failed';
        toast.error(state.error);
      })
      // Logout
      .addCase(logout.pending, (state) => {
        state.isAuthenticated = false;
        state.user = null;
      })
      .addCase(logout.fulfilled, () => {
        toast.success('Logged out successfully');
      })
      .addCase(logout.rejected, () => {
        toast.success('Logged out');
      });
  },
});

export const { clearError, updateUser } = authSlice.actions;
export default authSlice.reducer;
