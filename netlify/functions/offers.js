export const handler = async () => {
  const offers = {
    enabled: true,
    bgColor: '#b8962e',
    textColor: '#ffffff',
    items: [
      'Special offer on bridal wear this season!',
      'Free consultation for all new customers',
      '10% off on alterations this month'
    ]
  };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(offers),
  };
};
