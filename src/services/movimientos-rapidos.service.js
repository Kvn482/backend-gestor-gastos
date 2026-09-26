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

            CREATE TABLE IF NOT EXISTS movimiento_rapido_etiquetas (
                id_movimiento_rapido INT NOT NULL REFERENCES movimientos_rapidos(id) ON DELETE CASCADE,
                id_etiqueta INT NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
                PRIMARY KEY (id_movimiento_rapido, id_etiqueta)
            );

            INSERT INTO movimiento_rapido_etiquetas (id_movimiento_rapido, id_etiqueta)
            SELECT id, id_etiqueta
            FROM movimientos_rapidos
            WHERE id_etiqueta IS NOT NULL
            ON CONFLICT DO NOTHING;
        `);
        tableInitialized = true;
    } catch (error) {
        console.error('Error al asegurar tabla movimientos_rapidos:', error);
        throw error;
    }
};

const insertMovimientoRapidoEtiquetas = async (clientOrPool, id_movimiento_rapido, etiquetas = []) => {
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) return;

    const validEtiquetas = [...new Set(
        etiquetas
            .map(e => (typeof e === 'object' && e !== null ? Number(e.id) : Number(e)))
            .filter(id => Number.isInteger(id) && id > 0)
    )];

    if (validEtiquetas.length === 0) return;

    const values = validEtiquetas.map((_, i) => `($1, $${i + 2})`).join(', ');
    await clientOrPool.query(
        `INSERT INTO movimiento_rapido_etiquetas (id_movimiento_rapido, id_etiqueta)
         VALUES ${values}
         ON CONFLICT (id_movimiento_rapido, id_etiqueta) DO NOTHING`,
        [id_movimiento_rapido, ...validEtiquetas]
    );
};

const getMovimientoRapidoById = async (poolOrClient, id_usuario, id) => {
    const result = await poolOrClient.query(
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
            mr.created_at,
            COALESCE(
                array_agg(
                    json_build_object(
                        'id', et.id,
                        'nombre', et.nombre,
                        'color', et.color,
                        'icono', COALESCE(et.icono, 'tag'),
                        'tipo', et.tipo
                    )
                ) FILTER (WHERE et.id IS NOT NULL),
                '{}'::json[]
            ) AS etiquetas
        FROM movimientos_rapidos mr
        LEFT JOIN cuentas c ON c.id = mr.id_cuenta
        LEFT JOIN etiquetas e ON e.id = mr.id_etiqueta
        LEFT JOIN movimiento_rapido_etiquetas mre ON mre.id_movimiento_rapido = mr.id
        LEFT JOIN etiquetas et ON et.id = mre.id_etiqueta
        WHERE mr.id_usuario = $1 AND mr.id = $2
        GROUP BY mr.id, c.nombre, e.nombre, e.color`,
        [id_usuario, id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    if ((!row.etiquetas || row.etiquetas.length === 0) && row.categoriaId) {
        row.etiquetas = [{
            id: row.categoriaId,
            nombre: row.categoriaNombre,
            color: row.categoriaColor,
            icono: row.categoriaIcono
        }];
    }
    return row;
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
            mr.created_at,
            COALESCE(
                array_agg(
                    json_build_object(
                        'id', et.id,
                        'nombre', et.nombre,
                        'color', et.color,
                        'icono', COALESCE(et.icono, 'tag'),
                        'tipo', et.tipo
                    )
                ) FILTER (WHERE et.id IS NOT NULL),
                '{}'::json[]
            ) AS etiquetas
        FROM movimientos_rapidos mr
        LEFT JOIN cuentas c ON c.id = mr.id_cuenta
        LEFT JOIN etiquetas e ON e.id = mr.id_etiqueta
        LEFT JOIN movimiento_rapido_etiquetas mre ON mre.id_movimiento_rapido = mr.id
        LEFT JOIN etiquetas et ON et.id = mre.id_etiqueta
        WHERE mr.id_usuario = $1
        GROUP BY mr.id, c.nombre, e.nombre, e.color
        ORDER BY mr.orden ASC, mr.created_at DESC`,
        [id_usuario]
    );

    return result.rows.map(row => {
        if ((!row.etiquetas || row.etiquetas.length === 0) && row.categoriaId) {
            row.etiquetas = [{
                id: row.categoriaId,
                nombre: row.categoriaNombre,
                color: row.categoriaColor,
                icono: row.categoriaIcono
            }];
        }
        return row;
    });
};

const createOrUpsertMovimientoRapido = async (pool, id_usuario, data) => {
    await ensureTableExists(pool);

    const {
        nombre,
        tipoMovimiento = 2,
        monto,
        cuentaId = null,
        categoriaId = null,
        etiquetas = [],
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

    let etiquetasIds = [];
    if (Array.isArray(etiquetas) && etiquetas.length > 0) {
        etiquetasIds = [...new Set(
            etiquetas
                .map(e => (typeof e === 'object' && e !== null ? Number(e.id) : Number(e)))
                .filter(id => Number.isInteger(id) && id > 0)
        )];
    }

    let categoriaValida = categoriaId && !isNaN(Number(categoriaId)) ? Number(categoriaId) : null;
    if (!categoriaValida && etiquetasIds.length > 0) {
        categoriaValida = etiquetasIds[0];
    }
    if (categoriaValida && !etiquetasIds.includes(categoriaValida)) {
        etiquetasIds.unshift(categoriaValida);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verificar si ya existe con el mismo nombre para este usuario
        const existente = await client.query(
            `SELECT id FROM movimientos_rapidos 
             WHERE id_usuario = $1 AND LOWER(nombre) = LOWER($2)`,
            [id_usuario, nombreLimpio]
        );

        let movimientoId;
        if (existente.rows.length > 0) {
            movimientoId = existente.rows[0].id;
            await client.query(
                `UPDATE movimientos_rapidos 
                 SET id_tipo_movimiento = $1,
                     monto = $2,
                     id_cuenta = $3,
                     id_etiqueta = $4,
                     icono = $5,
                     color = $6,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $7 AND id_usuario = $8`,
                [tipoMovimiento, montoLimpio, cuentaValida, categoriaValida, icono, color, movimientoId, id_usuario]
            );

            await client.query(
                `DELETE FROM movimiento_rapido_etiquetas WHERE id_movimiento_rapido = $1`,
                [movimientoId]
            );
        } else {
            const insertado = await client.query(
                `INSERT INTO movimientos_rapidos 
                 (id_usuario, nombre, id_tipo_movimiento, monto, id_cuenta, id_etiqueta, icono, color)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id`,
                [id_usuario, nombreLimpio, tipoMovimiento, montoLimpio, cuentaValida, categoriaValida, icono, color]
            );
            movimientoId = insertado.rows[0].id;
        }

        if (etiquetasIds.length > 0) {
            await insertMovimientoRapidoEtiquetas(client, movimientoId, etiquetasIds);
        }

        await client.query('COMMIT');

        return await getMovimientoRapidoById(pool, id_usuario, movimientoId);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al guardar movimiento rápido:', error);
        throw error;
    } finally {
        client.release();
    }
};

const updateMovimientoRapido = async (pool, id_usuario, id, data) => {
    await ensureTableExists(pool);

    const {
        nombre,
        tipoMovimiento,
        monto,
        cuentaId,
        categoriaId,
        etiquetas,
        icono,
        color
    } = data;

    const campos = [];
    const valores = [];
    let contador = 1;

    let categoriaValida = undefined;
    if (categoriaId !== undefined) {
        categoriaValida = categoriaId ? Number(categoriaId) : null;
    }

    let etiquetasIds = undefined;
    if (etiquetas !== undefined && Array.isArray(etiquetas)) {
        etiquetasIds = [...new Set(
            etiquetas
                .map(e => (typeof e === 'object' && e !== null ? Number(e.id) : Number(e)))
                .filter(i => Number.isInteger(i) && i > 0)
        )];

        if (categoriaValida === undefined && etiquetasIds.length > 0) {
            categoriaValida = etiquetasIds[0];
        }
    }

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
    if (categoriaValida !== undefined) {
        campos.push(`id_etiqueta = $${contador++}`);
        valores.push(categoriaValida);
    }
    if (icono !== undefined) {
        campos.push(`icono = $${contador++}`);
        valores.push(icono);
    }
    if (color !== undefined) {
        campos.push(`color = $${contador++}`);
        valores.push(color);
    }

    if (campos.length === 0 && etiquetasIds === undefined) {
        throw new Error('No hay campos para actualizar');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (campos.length > 0) {
            campos.push(`updated_at = CURRENT_TIMESTAMP`);
            valores.push(id, id_usuario);

            const query = `
                UPDATE movimientos_rapidos
                SET ${campos.join(', ')}
                WHERE id = $${contador++} AND id_usuario = $${contador++}
                RETURNING id
            `;

            const result = await client.query(query, valores);
            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return null;
            }
        }

        if (etiquetasIds !== undefined) {
            await client.query(
                `DELETE FROM movimiento_rapido_etiquetas WHERE id_movimiento_rapido = $1`,
                [id]
            );
            if (etiquetasIds.length > 0) {
                await insertMovimientoRapidoEtiquetas(client, id, etiquetasIds);
            }
        }

        await client.query('COMMIT');

        return await getMovimientoRapidoById(pool, id_usuario, id);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al actualizar movimiento rápido:', error);
        throw error;
    } finally {
        client.release();
    }
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

