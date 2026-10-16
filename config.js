// ÚNICO punto de configuración por defecto: marca, negocio, moneda/locale, métodos de pago y gastos.
// Los colores viven en css/tokens.css (tema claro y oscuro). Si cambiás colores, verificá contraste AA (>= 4.5:1 texto).
// Contrastes verificados: #FFFFFF sobre #1D6B57 = 6.4:1 · #14201B sobre #F2F4F1 = 15.6:1 · #0A1511 sobre #5DBE9F = 8.6:1.
export default {
  appName: 'Nexo OS',
  tagline: 'Sistema operativo',
  logoUrl: 'assets/logo.svg',
  brandMark: 'NX',
  business: { name: 'Modas Centro', address: 'Av. Corrientes 1234, CABA', taxId: '30-71234567-8' },
  locale: 'es-AR',
  currency: 'ARS',
  timezone: 'America/Argentina/Buenos_Aires',
  decimals: 2,
  lowStockThreshold: 3,       // fallback de stock mínimo cuando un producto no define minStock
  paymentMethods: ['efectivo', 'transferencia', 'tarjeta', 'qr'], // habilitados por defecto (editable en Configuración)
  cashMethods: [],            // módulo Caja desactivado: ningún método de pago entra a una caja diaria
  cashTolerance: 500,
  cashStaleHours: 16,
  expenseCategories: ['Alquiler', 'Servicios', 'Sueldos', 'Marketing', 'Compra de mercadería', 'Limpieza', 'Impuestos', 'Varios'],
  merchandiseCategory: 'Compra de mercadería', // va al flujo de fondos, NO al resultado (el costo entra por CMV al vender)
  salaryCategory: 'Sueldos',
};
