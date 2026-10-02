// ÚNICO punto de configuración por defecto: marca, negocio, moneda/locale, métodos de pago, caja y gastos.
// Los colores viven en css/tokens.css (solo tema oscuro). Si cambiás colores, verificá contraste AA (>= 4.5:1 texto).
// Contrastes verificados: #FFFFFF sobre #A81F3D = 7.2:1 · #1A0F10 sobre #E8C077 = 11.6:1 · #FF6B8A sobre #0D0607 = 7.4:1.
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
  cashMethods: ['efectivo'],  // métodos de pago que entran a la caja (D4)
  cashTolerance: 500,         // |diferencia| > tolerancia exige nota al cerrar (D3)
  cashStaleHours: 16,         // caja abierta hace más de N h (o de un día anterior) genera notificación (D5)
  expenseCategories: ['Alquiler', 'Servicios', 'Sueldos', 'Marketing', 'Compra de mercadería', 'Limpieza', 'Impuestos', 'Varios'],
  merchandiseCategory: 'Compra de mercadería', // va al flujo de caja, NO al resultado (el costo entra por CMV al vender)
  salaryCategory: 'Sueldos',  // gastos de esta categoría pueden vincularse a un empleado (pago de sueldo)
  employeePositions: ['Encargado/a', 'Vendedor/a', 'Cajero/a', 'Administrativo/a', 'Depósito'],
};
