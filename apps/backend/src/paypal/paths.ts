/** PayPal REST paths, shown on each payment event as the call Fitcheck made. */
export const PAYPAL_PATHS = {
  authorize: (orderId: string) => `/v2/checkout/orders/${orderId}/authorize`,
  capture: (authorizationId: string) => `/v2/payments/authorizations/${authorizationId}/capture`,
  void: (authorizationId: string) => `/v2/payments/authorizations/${authorizationId}/void`,
  reauthorize: (authorizationId: string) =>
    `/v2/payments/authorizations/${authorizationId}/reauthorize`,
};
