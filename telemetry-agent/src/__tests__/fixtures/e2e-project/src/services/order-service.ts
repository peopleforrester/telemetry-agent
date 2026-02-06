interface Order {
  id: string;
  userId: string;
  total: number;
  items: string[];
}

export async function calculateOrderTotal(items: { price: number; quantity: number }[]) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return total;
}

export async function validateOrder(order: Order) {
  if (!order.userId) throw new Error('Missing userId');
  if (order.items.length === 0) throw new Error('Empty order');
  if (order.total <= 0) throw new Error('Invalid total');
  return true;
}
