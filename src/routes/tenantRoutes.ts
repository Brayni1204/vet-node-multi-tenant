import { Router } from 'express';
import pool from '../db';
import { RowDataPacket, OkPacket } from 'mysql2';

const router = Router();

// Interfaz para definir la estructura de los datos del inquilino
interface Tenant extends RowDataPacket {
    id: number;
    tenant_id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    schedule: string;
    logo_url: string;
    primary_color: string;
    secondary_color: string;
}

// Interfaz para los servicios
interface Service extends RowDataPacket {
    id: number;
    tenant_id: number;
    title: string;
    description: string;
    image: string;
}

// Ruta para obtener la información de un inquilino por su ID
router.get('/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    try {
        const [rows] = await pool.execute<Tenant[]>('SELECT * FROM tenants WHERE tenant_id = ?', [tenantId]);
        if (rows.length > 0) {
            const tenant = rows[0];
            const [servicesRows] = await pool.execute<Service[]>('SELECT id, title, description, image FROM services WHERE tenant_id = ?', [tenant.id]);
            res.json({
                id: tenant.id,
                tenant_id: tenant.tenant_id,
                name: tenant.name,
                logoUrl: tenant.logo_url,
                colors: { primary: tenant.primary_color, secondary: tenant.secondary_color },
                contact: { phone: tenant.phone, email: tenant.email, address: tenant.address, schedule: tenant.schedule },
                services: servicesRows
            });
        } else {
            res.status(404).json({ message: 'Inquilino no encontrado.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// Ruta para actualizar la información de un inquilino
router.put('/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { name, address, phone, schedule, email } = req.body;

    try {
        const [rows] = await pool.execute<Tenant[]>('SELECT id FROM tenants WHERE tenant_id = ?', [tenantId]);
        const tenant = rows[0];

        if (!tenant) {
            return res.status(404).json({ message: 'Inquilino no encontrado.' });
        }

        const [result] = await pool.execute<OkPacket>(
            'UPDATE tenants SET name = ?, address = ?, phone = ?, schedule = ?, email = ? WHERE id = ?',
            [name, address, phone, schedule, email, tenant.id]
        );

        if (result.affectedRows === 0) {
            return res.status(500).json({ message: 'No se pudo actualizar el inquilino.' });
        }

        res.status(200).json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// NUEVAS RUTAS PARA SERVICIOS

// Obtener todos los servicios de un inquilino
router.get('/:tenantId/services', async (req, res) => {
    const { tenantId } = req.params;
    try {
        const [rows] = await pool.execute<Tenant[]>('SELECT id FROM tenants WHERE tenant_id = ?', [tenantId]);
        const tenant = rows[0];
        if (!tenant) {
            return res.status(404).json({ message: 'Inquilino no encontrado.' });
        }
        const [servicesRows] = await pool.execute<Service[]>('SELECT id, title, description, image FROM services WHERE tenant_id = ?', [tenant.id]);
        res.json({ services: servicesRows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// Agregar un nuevo servicio
router.post('/:tenantId/services', async (req, res) => {
    const { tenantId } = req.params;
    const { title, description, image } = req.body;
    try {
        const [rows] = await pool.execute<Tenant[]>('SELECT id FROM tenants WHERE tenant_id = ?', [tenantId]);
        const tenant = rows[0];
        if (!tenant) {
            return res.status(404).json({ message: 'Inquilino no encontrado.' });
        }
        const [result] = await pool.execute<OkPacket>(
            'INSERT INTO services (tenant_id, title, description, image) VALUES (?, ?, ?, ?)',
            [tenant.id, title, description, image]
        );
        res.status(201).json({ message: 'Servicio agregado con éxito.', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// Actualizar un servicio
router.put('/:tenantId/services/:serviceId', async (req, res) => {
    const { tenantId, serviceId } = req.params;
    const { title, description, image } = req.body;
    try {
        const [rows] = await pool.execute<Tenant[]>('SELECT id FROM tenants WHERE tenant_id = ?', [tenantId]);
        const tenant = rows[0];
        if (!tenant) {
            return res.status(404).json({ message: 'Inquilino no encontrado.' });
        }
        const [result] = await pool.execute<OkPacket>(
            'UPDATE services SET title = ?, description = ?, image = ? WHERE id = ? AND tenant_id = ?',
            [title, description, image, serviceId, tenant.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Servicio no encontrado o no pertenece a este inquilino.' });
        }
        res.status(200).json({ message: 'Servicio actualizado con éxito.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// Eliminar un servicio
router.delete('/:tenantId/services/:serviceId', async (req, res) => {
    const { tenantId, serviceId } = req.params;
    try {
        const [rows] = await pool.execute<Tenant[]>('SELECT id FROM tenants WHERE tenant_id = ?', [tenantId]);
        const tenant = rows[0];
        if (!tenant) {
            return res.status(404).json({ message: 'Inquilino no encontrado.' });
        }
        const [result] = await pool.execute<OkPacket>(
            'DELETE FROM services WHERE id = ? AND tenant_id = ?',
            [serviceId, tenant.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Servicio no encontrado o no pertenece a este inquilino.' });
        }
        res.status(200).json({ message: 'Servicio eliminado con éxito.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

export default router;