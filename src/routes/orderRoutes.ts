// src/routes/orderRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, ResultSetHeader, OkPacket } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router();

// --- Interfaces y Middlewares (Sin cambios) ---
interface OrderRequest<P extends ParamsDictionary> extends Request<P> {
    user?: {
        id: number;
        tenant_id: string;
        role: 'client';
    };
    tenantId?: string;
    resolvedTenant?: {
        id: number;
        slug: string;
    }
}

const getTenantInfoBySlug = async (tenantSlug: string): Promise<{ id: number; slug: string } | null> => {
    const [tenantRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id, tenant_id FROM tenants WHERE tenant_id = ?',
        [tenantSlug]
    );
    if (tenantRows.length === 0) return null;
    return { id: tenantRows[0].id, slug: tenantRows[0].tenant_id };
};

const verifyClientToken = (req: OrderRequest<any>, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'No autenticado.' });
    }
    try {
        const [tenant_slug, role, client_id] = token.split(':');
        if (!tenant_slug || role !== 'client' || !client_id) {
            return res.status(401).json({ message: 'Token de cliente no válido.' });
        }
        req.user = {
            id: parseInt(client_id, 10),
            tenant_id: tenant_slug,
            role: 'client'
        };
    } catch (e) {
        return res.status(401).json({ message: 'Token inválido.' });
    }
    next();
};

const ensureTenantAccess = async (req: OrderRequest<any>, res: Response, next: NextFunction) => {
    const requestedTenantSlug = req.tenantId;
    const authenticatedTenantSlug = req.user?.tenant_id;
    if (!requestedTenantSlug) {
        return res.status(400).json({ message: 'Slug de inquilino no encontrado.' });
    }
    const tenantInfo = await getTenantInfoBySlug(requestedTenantSlug);
    if (tenantInfo === null) {
        return res.status(404).json({ message: `Inquilino ${requestedTenantSlug} no encontrado.` });
    }
    req.resolvedTenant = tenantInfo;
    if (!req.user || authenticatedTenantSlug !== requestedTenantSlug) {
        return res.status(403).json({ message: 'Acceso denegado.' });
    }
    next();
};

// Helper para construir URL de imagen
const getDisplayImageUrl = (path: string, hostname: string) => {
    if (!path) return null;
    const host = hostname.split(':')[0]; // Quita puerto (ej. 5173)
    return path.startsWith('http') ? path : `http://${host}:4000${path}`;
};


// -----------------------------------------------------------------------------
// 1. CREAR NUEVO PEDIDO (RESERVA) (ACTUALIZADO con validación de 10 días)
// POST /api/orders
// -----------------------------------------------------------------------------
router.post('/', verifyClientToken, ensureTenantAccess, async (req: OrderRequest<any>, res: Response) => {
    const { items, pickupDate }: {
        items: { productId: number, quantity: number }[],
        pickupDate: string // Formato 'YYYY-MM-DD'
    } = req.body;

    const { id: tenantDbId } = req.resolvedTenant!;
    const clientId = req.user!.id;

    if (!items || items.length === 0 || !pickupDate) {
        return res.status(400).json({ message: 'Faltan productos o fecha de recojo.' });
    }

    // --- 🔽 NUEVA VALIDACIÓN DE FECHA (LADO SERVIDOR) 🔽 ---
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const selectedDate = new Date(pickupDate + 'T00:00:00');

    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 10); // Hoy + 10 días

    // Comparamos los timestamps
    if (selectedDate.getTime() <= today.getTime()) {
        return res.status(400).json({ message: 'La fecha de recojo debe ser en el futuro.' });
    }
    if (selectedDate.getTime() > maxDate.getTime()) {
        return res.status(400).json({ message: 'La fecha de recojo no puede superar los 10 días.' });
    }
    // --- 🔼 FIN DE VALIDACIÓN 🔼 ---

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let totalAmount = 0;
        const productPrices: { [key: number]: number } = {};

        // 1. Verificar stock y calcular total
        for (const item of items) {
            const [rows] = await connection.execute<RowDataPacket[]>(
                'SELECT price, stock FROM products WHERE id = ? AND tenant_id = ? AND is_available = TRUE FOR UPDATE',
                [item.productId, tenantDbId]
            );
            if (rows.length === 0) throw new Error(`El producto ID ${item.productId} no está disponible.`);
            const product = rows[0];
            if (product.stock < item.quantity) throw new Error(`Stock insuficiente para el producto ID ${item.productId}.`);

            const price = parseFloat(product.price);
            productPrices[item.productId] = price;
            totalAmount += price * item.quantity;
        }

        // 2. Crear la orden
        const expirationDate = new Date(pickupDate + 'T00:00:00');
        expirationDate.setDate(expirationDate.getDate() + 2); // Expira 2 días después

        const [orderResult] = await connection.execute<OkPacket>(
            `INSERT INTO orders (tenant_id, client_id, total_amount, status, pickup_date, expiration_date) 
             VALUES (?, ?, ?, 'pending_pickup', ?, ?)`,
            [tenantDbId, clientId, totalAmount, pickupDate, expirationDate]
        );
        const orderId = orderResult.insertId;

        // 3. Insertar items y actualizar stock
        for (const item of items) {
            await connection.execute(
                'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                [orderId, item.productId, item.quantity, productPrices[item.productId]]
            );
            await connection.execute(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, item.productId]
            );
        }

        await connection.commit();
        res.status(201).json({
            message: 'Reserva creada exitosamente.',
            orderId: orderId,
            total: totalAmount
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error al crear la orden:", error);
        const errorMessage = error instanceof Error ? error.message : 'Error del servidor.';
        res.status(500).json({ message: errorMessage });
    } finally {
        connection.release();
    }
});


// -----------------------------------------------------------------------------
// 2. ⭐️ OBTENER "MIS PEDIDOS" (Historial del cliente) ⭐️
// GET /api/orders/my-orders
// -----------------------------------------------------------------------------
router.get('/my-orders', verifyClientToken, ensureTenantAccess, async (req: OrderRequest<any>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const clientId = req.user!.id;

    try {
        // 1. Obtener todas las órdenes del cliente
        const [orders] = await pool.execute<RowDataPacket[]>(
            `SELECT id, total_amount, status, pickup_date, created_at 
             FROM orders 
             WHERE client_id = ? AND tenant_id = ? 
             ORDER BY created_at DESC`,
            [clientId, tenantDbId]
        );

        if (orders.length === 0) {
            return res.status(200).json({ orders: [] });
        }

        const orderIds = orders.map(o => o.id);

        // 2. Obtener todos los items para esas órdenes en una sola consulta
        const [items] = await pool.execute<RowDataPacket[]>(
            `SELECT 
                oi.order_id, oi.product_id, oi.quantity, oi.unit_price,
                p.name AS product_name,
                i.url AS product_image
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
             LEFT JOIN images i ON pi.image_id = i.id
             WHERE oi.order_id IN (?)`,
            [orderIds] // pool.execute maneja la expansión del array [1, 2, 3] a (1, 2, 3)
        );

        // 3. Mapear los items a sus órdenes
        const ordersWithItems = orders.map(order => {
            const orderItems = items
                .filter(item => item.order_id === order.id)
                .map(item => ({
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: parseFloat(item.unit_price),
                    product_name: item.product_name,
                    product_image: item.product_image ? getDisplayImageUrl(item.product_image, req.hostname) : null
                }));

            return {
                id: order.id,
                total_amount: parseFloat(order.total_amount),
                status: order.status,
                pickup_date: order.pickup_date,
                created_at: order.created_at,
                items: orderItems
            };
        });

        res.status(200).json({ orders: ordersWithItems });

    } catch (error) {
        console.error("Error al obtener 'mis pedidos':", error);
        res.status(500).json({ message: 'Error del servidor al obtener el historial de pedidos.' });
    }
});


export default router;