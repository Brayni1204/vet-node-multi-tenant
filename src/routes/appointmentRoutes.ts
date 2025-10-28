// src/routes/appointmentRoutes.ts (Modificado)
import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// Ruta para agendar una nueva cita
router.post('/appointments', async (req, res) => {
    // ⚠️ Cambiamos userId por clientId
    const { clientId, tenantId, petName, petType, service, appointmentDate, appointmentTime, notes } = req.body;
    if (!clientId || !tenantId || !petName || !petType || !service || !appointmentDate || !appointmentTime) {
        return res.status(400).json({ message: 'Faltan campos obligatorios para la cita.' });
    }
    // 🆕 Paso adicional: Verificar que el cliente existe en la tabla `clients`
    try {
        const [clientCheck] = await pool.execute(
            'SELECT id FROM clients WHERE id = ? AND tenant_id = ?',
            [clientId, tenantId]
        );
        if (Array.isArray(clientCheck) && clientCheck.length === 0) {
            return res.status(404).json({ message: 'Client ID not found for this tenant.' });
        }
    } catch (error) {
        // Si la verificación falla, devolvemos un error del servidor.
        console.error("Error validando cliente:", error);
        return res.status(500).json({ message: 'Error del servidor al validar el cliente.' });
    }

    // Lógica para validar la disponibilidad del horario
    try {
        const [existingAppointments] = await pool.execute(
            'SELECT * FROM appointments WHERE tenant_id = ? AND appointment_date = ? AND appointment_time = ?',
            [tenantId, appointmentDate, appointmentTime]
        );

        if (Array.isArray(existingAppointments) && existingAppointments.length > 0) {
            return res.status(409).json({ message: 'Este horario ya está reservado.' });
        }

        // Si el horario está disponible, agendamos la cita
        // ⚠️ Cambiamos `user_id` por `client_id`
        const [result] = await pool.execute(
            'INSERT INTO appointments (client_id, tenant_id, pet_name, pet_type, service, appointment_date, appointment_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [clientId, tenantId, petName, petType, service, appointmentDate, appointmentTime, notes]
        );

        res.status(201).json({ message: 'Cita agendada con éxito', id: (result as any).insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor' });
    }
});

export default router;