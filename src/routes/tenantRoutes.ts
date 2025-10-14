import { Router } from 'express';
import pool from '../db';

const router = Router();

// Ruta para obtener la información de un inquilino por su ID
router.get('/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    try {
        const [rows] = await pool.execute('SELECT * FROM tenants WHERE tenant_id = ?', [tenantId]);
        if (Array.isArray(rows) && rows.length > 0) {
            const tenant = rows[0];
            // También obtenemos los servicios de este inquilino
            const [services] = await pool.execute('SELECT title, description, image FROM services WHERE tenant_id = ?', [tenant.id]);
            res.json({ ...tenant, services });
        } else {
            res.status(404).json({ message: 'Inquilino no encontrado.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

export default router;