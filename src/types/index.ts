export interface Product {
  id?: string;
  name: string;
  price: number;
  imageUrl: string;
  categoryId: string;
  active: boolean;
  stock?: number;
}

export interface Category {
  id?: string;
  name: string;
  active: boolean;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export interface Order {
  id?: string;
  orderNumber: string;
  source: 'kasir' | 'shop';
  customer?: {
    name: string;
    email: string;
    googleUid: string;
  };
  items: CartItem[];
  total: number;
  status: 'NEW' | 'PROCESSING' | 'READY' | 'COMPLETED';
  createdAt: number;
  paymentMethod?: 'tunai' | 'qris';
  cashAmount?: number; // Uang yang dibayar (untuk hitung kembalian)
  changeAmount?: number; // Kembalian
}