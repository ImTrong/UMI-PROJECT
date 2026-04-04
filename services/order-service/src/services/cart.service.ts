import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

interface CartItem {
  courseId: string;
  title: string;
  price: number;
  thumbnail?: string;
}

export class CartService {
  static async getCart(userId: string) {
    let cart = await prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          userId,
          items: [],
          totalPrice: 0,
        },
      });
    }

    return cart;
  }

  static async addToCart(userId: string, courseId: string) {
    // Get course details from course service
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    let course;
    
    try {
      const response = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`);
      course = response.data.data;
      
      if (!course.published) {
        throw new Error('Course is not published');
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
      }
      throw error;
    }

    // Get existing cart
    let cart = await prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          userId,
          items: [],
          totalPrice: 0,
        },
      });
    }

    // Parse existing items
    const items = cart.items as unknown as CartItem[];
    
    // Check if course already in cart
    const existingItem = items.find(item => item.courseId === courseId);
    if (existingItem) {
      throw new Error(ERROR_MESSAGES.COURSE_ALREADY_IN_CART);
    }

    // Add new item
    const newItem: CartItem = {
      courseId,
      title: course.title,
      price: course.price,
      thumbnail: course.thumbnail,
    };
    
    items.push(newItem);
    
    // Calculate total price
    const totalPrice = items.reduce((sum, item) => sum + item.price, 0);
    
    // Update cart
    const updatedCart = await prisma.cart.update({
      where: { userId },
      data: {
        items: items as any,
        totalPrice,
      },
    });

    logger.info(`Course ${courseId} added to cart for user ${userId}`);
    return updatedCart;
  }

  static async removeFromCart(userId: string, courseId: string) {
    const cart = await prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      throw new Error(ERROR_MESSAGES.CART_NOT_FOUND);
    }

    const items = cart.items as unknown as CartItem[];
    const filteredItems = items.filter(item => item.courseId !== courseId);
    
    if (items.length === filteredItems.length) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }
    
    const totalPrice = filteredItems.reduce((sum, item) => sum + item.price, 0);
    
    const updatedCart = await prisma.cart.update({
      where: { userId },
      data: {
        items: filteredItems as any,
        totalPrice,
      },
    });

    logger.info(`Course ${courseId} removed from cart for user ${userId}`);
    return updatedCart;
  }

  static async clearCart(userId: string) {
    const cart = await prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      throw new Error(ERROR_MESSAGES.CART_NOT_FOUND);
    }

    const updatedCart = await prisma.cart.update({
      where: { userId },
      data: {
        items: [],
        totalPrice: 0,
      },
    });

    logger.info(`Cart cleared for user ${userId}`);
    return updatedCart;
  }

  static async getCartTotal(userId: string) {
    const cart = await this.getCart(userId);
    return {
      totalItems: (cart.items as unknown as CartItem[]).length,
      totalPrice: cart.totalPrice,
    };
  }
}
