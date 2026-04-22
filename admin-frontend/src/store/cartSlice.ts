import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { orderService, Cart } from '../services/order.service';
import { logout } from './authSlice';
import toast from 'react-hot-toast';

interface CartState {
  items: Cart['items'];
  totalPrice: number;
  itemCount: number;
  loading: boolean;
}

const initialState: CartState = {
  items: [],
  totalPrice: 0,
  itemCount: 0,
  loading: false,
};

export const fetchCart = createAsyncThunk('cart/fetchCart', async () => {
  const cart = await orderService.getCart();
  return cart;
});

export const addToCart = createAsyncThunk(
  'cart/addToCart',
  async (courseId: string) => {
    const cart = await orderService.addToCart(courseId);
    return cart;
  }
);

export const removeFromCart = createAsyncThunk(
  'cart/removeFromCart',
  async (courseId: string) => {
    const cart = await orderService.removeFromCart(courseId);
    return cart;
  }
);

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    clearCart: (state) => {
      state.items = [];
      state.totalPrice = 0;
      state.itemCount = 0;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCart.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.totalPrice = action.payload.totalPrice;
        state.itemCount = action.payload.items.length;
      })
      .addCase(addToCart.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.totalPrice = action.payload.totalPrice;
        state.itemCount = action.payload.items.length;
        toast.success('Added to cart');
      })
      .addCase(removeFromCart.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.totalPrice = action.payload.totalPrice;
        state.itemCount = action.payload.items.length;
        toast.success('Removed from cart');
      })
      // Clear on logout
      .addCase(logout.pending, (state) => {
        state.items = [];
        state.totalPrice = 0;
        state.itemCount = 0;
      });
  },
});

export const { clearCart } = cartSlice.actions;
export default cartSlice.reducer;
