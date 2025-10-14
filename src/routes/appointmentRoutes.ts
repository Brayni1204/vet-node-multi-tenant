import { Router } from 'express';
import pool from '../db';

const router = Router();

// Ruta para agendar una nueva cita
router.post('/appointments', async (req, res) => {
    const { userId, tenantId, petName, petType, service, appointmentDate, appointmentTime, notes } = req.body;

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
        const [result] = await pool.execute(
            'INSERT INTO appointments (user_id, tenant_id, pet_name, pet_type, service, appointment_date, appointment_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, tenantId, petName, petType, service, appointmentDate, appointmentTime, notes]
        );

        res.status(201).json({ message: 'Cita agendada con éxito', id: (result as any).insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor' });
    }
});

export default router;