/**
 * Minimal ambient type declaration for the `razorpay` npm package, which ships
 * without TypeScript types. Declares only the surface MIRAAI uses, server-side:
 * order creation/fetch and payment fetch. Keeps the build and tests type-safe
 * without adding a dependency.
 */
declare module 'razorpay' {
  namespace Razorpay {
    interface OrdersResource {
      create(params: {
        amount: number
        currency: string
        receipt: string
        notes?: Record<string, string>
        payment_capture?: 0 | 1
      }): Promise<unknown>
      fetch(orderId: string): Promise<unknown>
    }
    interface PaymentsResource {
      fetch(paymentId: string): Promise<unknown>
    }
    interface RazorpayInstance {
      orders: OrdersResource
      payments: PaymentsResource
    }
    interface RazorpayOptions {
      key_id: string
      key_secret: string
    }
  }

  interface RazorpayConstructor {
    new (options: Razorpay.RazorpayOptions): Razorpay.RazorpayInstance
  }

  const Razorpay: RazorpayConstructor
  export = Razorpay
}
