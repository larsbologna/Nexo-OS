# Nexo OS · Registro de decisiones

**Etapa actual:** 3 — Revisión del rediseño (esperando aprobación)
**Última actualización:** 2026-10-16

## Pedido (2026-10-16)
- Quitar los módulos **Caja** y **Empleados**.
- Cambiar por completo el branding y el diseño (el mismo que se mostró en el artifact "Nexo — Demo Panel de Gestión").
- Se eligió rediseñar esta app real (no reemplazarla por la demo estática).

## Cambios hechos (pendientes de aprobación)
- Sin Caja: se quitaron la vista, el ítem del menú, la píldora "Caja abierta/cerrada" de la barra superior, los avisos de caja del Resumen y las preguntas de caja al cobrar, registrar o anular gastos y ventas. `config.js` → `cashMethods: []` apaga la lógica de caja en el repo; los datos históricos no se borran.
- Sin Empleados: se quitaron la vista, el selector de vendedor en Ventas, la columna y el filtro de vendedor en el Historial, y el vínculo de sueldos con empleados en Gastos.
- "Flujo de caja" pasó a llamarse "Flujo de fondos" en Finanzas para no confundirlo con el módulo eliminado.
- Esquema de datos v7: al abrir la nueva versión, cada navegador vuelve a generar los datos de demo.

## Branding propuesto
- Personalidad: herramienta de mostrador, clara y confiable, tipo libro contable moderno.
- Logo: dos anillos enlazados (el "nexo") con un punto ámbar.
- Claro: fondo #F2F4F1 · superficie #FFFFFF · texto #14201B · texto secundario #4B5A53
- Acento verde pino #1D6B57 · señal ámbar #D9921F
- Estados: OK #2C7A4C · atención #8E5A0F · crítico #B3372F
- Oscuro: fondo #0E1311 · superficie #151C19 · acento #5DBE9F · señal #EDB04F
- Tipografías: Bricolage Grotesque (títulos y cifras), Instrument Sans (texto), IBM Plex Mono (fechas, SKU, montos en tablas)
