// src/routes/appointmentRoutes.ts (Modificado para usar Auth y Tenant Check)
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, OkPacket } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

// Interfaces adaptadas para la autenticación
interface AppointmentRequest extends Request {
    user?: {
        id: number;
        tenant_id: string; // Slug (e.g., 'chavez') del usuario autenticado
        role: 'admin' | 'doctor' | 'receptionist' | 'client';
    };
    // tenantId inyectado por resolveTenant middleware (Slug del subdominio/header)
    tenantId?: string;
}

// -----------------------------------------------------------------------------
// 🔐 MIDDLEWARE DE AUTENTICACIÓN
const verifyToken = (req: AppointmentRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'No autenticado. Token no proporcionado.' });
    }

    // SIMULACIÓN DINÁMICA: Asumimos que el token es un string con el formato "slug:role"
    try {
        const [tenant_slug, role] = token.split(':');

        if (!tenant_slug || !['admin', 'doctor', 'receptionist', 'client'].includes(role)) {
            return res.status(401).json({ message: 'Token de simulación no válido.' });
        }

        (req as any).user = {
            id: 1, // Mock ID
            tenant_id: tenant_slug, // El tenant_id (slug) del usuario autenticado
            role: role as any,
        };

    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado.' });
    }

    next();
};

// 🛡️ MIDDLEWARE DE AUTORIZACIÓN PARA CITAS (Asegura que el usuario solo reserve en su propio inquilino)
const ensureSameTenant = (req: AppointmentRequest, res: Response, next: NextFunction) => {
    const { tenantId: requestedTenantSlug, clientId } = req.body;
    const authenticatedTenantSlug = req.user?.tenant_id;
    const userRole = req.user?.role;

    if (!authenticatedTenantSlug) {
        return res.status(401).json({ message: 'No se pudo verificar el inquilino del usuario autenticado.' });
    }

    // El tenant solicitado en el cuerpo debe coincidir con el tenant autenticado
    if (requestedTenantSlug !== authenticatedTenantSlug) {
        return res.status(403).json({ message: 'Acceso denegado. No puede crear citas para otro inquilino.' });
    }

    // Lógica para Clientes: Un cliente sólo puede reservar para sí mismo.
    // Esto asume que el `clientId` en el cuerpo es el ID numérico del cliente autenticado.
    if (userRole === 'client' && clientId !== req.user?.id) {
        return res.status(403).json({ message: 'Acceso denegado. Un cliente solo puede reservar para sí mismo.' });
    }

    next();
};


const router = Router();

// Ruta para agendar una nueva cita
// Aplicamos verifyToken y ensureSameTenant
router.post('/appointments', verifyToken, ensureSameTenant, async (req: AppointmentRequest, res: Response) => {
    const { clientId, tenantId, petName, petType, service, appointmentDate, appointmentTime, notes } = req.body;

    // El chequeo de tenant y el cliente ya se hizo en `ensureSameTenant`
    if (!clientId || !tenantId || !petName || !petType || !service || !appointmentDate || !appointmentTime) {
        return res.status(400).json({ message: 'Faltan campos obligatorios para la cita.' });
    }

    // Paso adicional: Verificar que el cliente existe en la tabla `clients`
    try {
        const [clientCheck] = await pool.execute<RowDataPacket[]>(
            // Buscamos por el ID del cliente y que pertenezca al tenant por slug
            'SELECT id FROM clients WHERE id = ? AND tenant_id = (SELECT id FROM tenants WHERE tenant_id = ?)',
            [clientId, tenantId]
        );
        if (clientCheck.length === 0) {
            return res.status(404).json({ message: 'Client ID not found for this tenant.' });
        }
    } catch (error) {
        console.error("Error validando cliente:", error);
        return res.status(500).json({ message: 'Error del servidor al validar el cliente.' });
    }

    // Lógica para validar la disponibilidad del horario
    try {
        // Obtenemos el ID numérico del tenant para la tabla appointments
        const [tenantRows] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?',
            [tenantId]
        );
        // Si ya pasó ensureSameTenant, tenantRows no debería ser 0, pero por seguridad
        if (tenantRows.length === 0) return res.status(404).json({ message: 'Inquilino no encontrado para la cita.' });

        const tenantNumericId = tenantRows[0].id;

        const [existingAppointments] = await pool.execute<RowDataPacket[]>(
            'SELECT * FROM appointments WHERE tenant_id = ? AND appointment_date = ? AND appointment_time = ?',
            [tenantNumericId, appointmentDate, appointmentTime]
        );

        if (existingAppointments.length > 0) {
            return res.status(409).json({ message: 'Este horario ya está reservado.' });
        }

        // Si el horario está disponible, agendamos la cita
        const [result] = await pool.execute<OkPacket>(
            'INSERT INTO appointments (client_id, tenant_id, pet_name, pet_type, service, appointment_date, appointment_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [clientId, tenantNumericId, petName, petType, service, appointmentDate, appointmentTime, notes]
        );

        res.status(201).json({ message: 'Cita agendada con éxito', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor' });
    }
});

export default router;