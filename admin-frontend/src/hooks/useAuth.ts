import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import { login, register, logout } from '../store/authSlice';

export const useAuth = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { user, isAuthenticated, loading, error } = useSelector(
    (state: RootState) => state.auth
  );

  return {
    user,
    isAuthenticated,
    loading,
    error,
    login: (email: string, password: string) =>
      dispatch(login({ email, password })),
    register: (email: string, password: string, fullName: string) =>
      dispatch(register({ email, password, fullName })),
    logout: () => dispatch(logout()),
  };
};
