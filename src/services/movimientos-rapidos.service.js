let tableInitialized = false;

const ensureTableExists = async (pool) => {
    if (tableInitialized) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS movimientos_rapidos (
                id SERIAL PRIMARY KEY,
                id_usuario UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                nombre VARCHAR(100) NOT NULL,
                id_tipo_movimiento INT NOT NULL REFERENCES tipos_movimiento(id),
                monto NUMERIC(12, 2) NOT NULL,
                id_cuenta UUID REFERENCES cuentas(id) ON DELETE SET NULL,
                id_etiqueta INT REFERENCES etiquetas(id) ON DELETE SET NULL,
                icono VARCHAR(50) DEFAULT 'tag',
                color VARCHAR(20) DEFAULT '#6366f1',
                orden INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        tableInitialized = true;
    } catch (error) {
        console.error('Error al asegurar tabla movimientos_rapidos:', error);
        throw error;
    }
};

const getMovimientosRapidos = async (pool, id_usuario) => {
    await ensureTableExists(pool);

    const result = await pool.query(
        `SELECT 
            mr.id,
            mr.nombre,
            mr.id_tipo_movimiento AS "tipoMovimiento",
            mr.monto::float AS monto,
            mr.id_cuenta AS "cuentaId",
            COALESCE(c.nombre, 'Efectivo') AS "cuentaNombre",
            mr.id_etiqueta AS "categoriaId",
            COALESCE(e.nombre, 'General') AS "categoriaNombre",
            COALESCE(mr.color, e.color, '#6366f1') AS "categoriaColor",
            COALESCE(mr.icono, 'tag') AS "categoriaIcono",
            mr.orden,
            mr.created_at
        FROM movimientos_rapidos mr
        LEFT JOIN cuentas c ON c.id = mr.id_cuenta
        LEFT JOIN etiquetas e ON e.id = mr.id_etiqueta
        WHERE mr.id_usuario = $1
        ORDER BY mr.orden ASC, mr.created_at DESC`,
        [id_usuario]
    );

    return result.rows;
};

const createOrUpsertMovimientoRapido = async (pool, id_usuario, data) => {
    await ensureTableExists(pool);

    const {
        nombre,
        tipoMovimiento = 2,
        monto,
        cuentaId = null,
        categoriaId = null,
        icono = 'tag',
        color = '#6366f1'
    } = data;

    const nombreLimpio = String(nombre || '').trim();
    if (!nombreLimpio) {
        throw new Error('El nombre del movimiento rápido es obligatorio');
    }

    const montoLimpio = Math.abs(Number(monto) || 0);
    if (montoLimpio <= 0) {
        throw new Error('El monto debe ser mayor a 0');
    }

    const cuentaValida = cuentaId && String(cuentaId).trim() !== '' ? String(cuentaId).trim() : null;
    const categoriaValida = categoriaId && !isNaN(Number(categoriaId)) ? Number(categoriaId) : null;

    // Verificar si ya existe con el mismo nombre para este usuario
    const existente = await pool.query(
        `SELECT id FROM movimientos_rapidos 
         WHERE id_usuario = $1 AND LOWER(nombre) = LOWER($2)`,
        [id_usuario, nombreLimpio]
    );

    if (existente.rows.length > 0) {
        const idExistente = existente.rows[0].id;
        const actualizado = await pool.query(
            `UPDATE movimientos_rapidos 
             SET id_tipo_movimiento = $1,
                 monto = $2,
                 id_cuenta = $3,
                 id_etiqueta = $4,
                 icono = $5,
                 color = $6,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $7 AND id_usuario = $8
             RETURNING *`,
            [tipoMovimiento, montoLimpio, cuentaValida, categoriaValida, icono, color, idExistente, id_usuario]
        );
        return actualizado.rows[0];
    }

    const insertado = await pool.query(
        `INSERT INTO movimientos_rapidos 
         (id_usuario, nombre, id_tipo_movimiento, monto, id_cuenta, id_etiqueta, icono, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [id_usuario, nombreLimpio, tipoMovimiento, montoLimpio, cuentaValida, categoriaValida, icono, color]
    );

    return insertado.rows[0];
};

const updateMovimientoRapido = async (pool, id_usuario, id, data) => {
    await ensureTableExists(pool);

    const {
        nombre,
        tipoMovimiento,
        monto,
        cuentaId,
        categoriaId,
        icono,
        color
    } = data;

    const campos = [];
    const valores = [];
    let contador = 1;

    if (nombre !== undefined) {
        campos.push(`nombre = $${contador++}`);
        valores.push(String(nombre).trim());
    }
    if (tipoMovimiento !== undefined) {
        campos.push(`id_tipo_movimiento = $${contador++}`);
        valores.push(Number(tipoMovimiento));
    }
    if (monto !== undefined) {
        campos.push(`monto = $${contador++}`);
        valores.push(Math.abs(Number(monto)));
    }
    if (cuentaId !== undefined) {
        campos.push(`id_cuenta = $${contador++}`);
        valores.push(cuentaId && String(cuentaId).trim() !== '' ? String(cuentaId).trim() : null);
    }
    if (categoriaId !== undefined) {
        campos.push(`id_etiqueta = $${contador++}`);
        valores.push(categoriaId ? Number(categoriaId) : null);
    }
    if (icono !== undefined) {
        campos.push(`icono = $${contador++}`);
        valores.push(icono);
    }
    if (color !== undefined) {
        campos.push(`color = $${contador++}`);
        valores.push(color);
    }

    if (campos.length === 0) {
        throw new Error('No hay campos para actualizar');
    }

    campos.push(`updated_at = CURRENT_TIMESTAMP`);
    valores.push(id, id_usuario);

    const query = `
        UPDATE movimientos_rapidos
        SET ${campos.join(', ')}
        WHERE id = $${contador++} AND id_usuario = $${contador++}
        RETURNING *
    `;

    const result = await pool.query(query, valores);
    return result.rows[0];
};

const deleteMovimientoRapido = async (pool, id_usuario, id) => {
    await ensureTableExists(pool);

    const result = await pool.query(
        `DELETE FROM movimientos_rapidos 
         WHERE id = $1 AND id_usuario = $2
         RETURNING id`,
        [id, id_usuario]
    );

    return result.rowCount > 0;
};

module.exports = {
    ensureTableExists,
    getMovimientosRapidos,
    createOrUpsertMovimientoRapido,
    updateMovimientoRapido,
    deleteMovimientoRapido
};

