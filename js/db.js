// db.js: guardar y leer datos en IndexedDB (la base de datos del navegador, dentro del iPhone).
//
// IndexedDB funciona con "almacenes" (como tablas) que guardan objetos JS tal cual.
// Su API original usa eventos (onsuccess, onerror…); aquí la envolvemos en promesas
// para poder escribir `await bd.guardar(...)`, que se lee mucho mejor.
//
// Uso:
//   import { bd } from './db.js';
//   await bd.guardar('jugadores', { id: 'yo', nombre: 'Yo' });
//   const yo = await bd.leer('jugadores', 'yo');
//
// Si algo falla (sin espacio, base de datos no disponible…), las funciones lanzan un ErrorBD
// con un mensaje claro en español. app.js lo enseña en pantalla (ver avisos.js).

const NOMBRE = 'poker-estudio';

// Si algún día cambia la estructura (un almacén o un índice nuevo), se sube VERSION_BD
// y se añade un bloque nuevo en actualizarEstructura(). Los datos existentes se conservan.
const VERSION_BD = 1;

// Almacenes previstos en el plan (2.5). Los de la Fase 2 se usan ya; el resto se crean
// desde el principio para no tener que cambiar la estructura más adelante.
function actualizarEstructura(bdNativa, versionAnterior) {
  if (versionAnterior < 1) {
    bdNativa.createObjectStore('jugadores', { keyPath: 'id' });

    const partidas = bdNativa.createObjectStore('partidas', { keyPath: 'id' });
    partidas.createIndex('estado', 'estado');

    const manos = bdNativa.createObjectStore('manos', { keyPath: 'id' });
    manos.createIndex('partidaId', 'partidaId');
    manos.createIndex('fecha', 'fecha');

    const participaciones = bdNativa.createObjectStore('participaciones', { keyPath: 'id' });
    participaciones.createIndex('jugadorId', 'jugadorId');
    participaciones.createIndex('manoId', 'manoId');

    bdNativa.createObjectStore('ajustes', { keyPath: 'clave' });
  }
}

/** Error de la base de datos con un mensaje pensado para la persona que usa la app. */
export class ErrorBD extends Error {
  constructor(mensaje, causa) {
    super(mensaje);
    this.name = 'ErrorBD';
    this.causa = causa; // el error original, para la consola
  }
}

/** Traduce un error de IndexedDB a un mensaje claro. */
export function mensajeParaUsuario(error) {
  const nombre = error && error.name;
  if (nombre === 'QuotaExceededError') {
    return 'No queda espacio para guardar datos en este iPhone. Libera espacio (Ajustes del iPhone › General › Almacenamiento) y vuelve a intentarlo. Lo último que hiciste no se ha guardado.';
  }
  if (nombre === 'VersionError') {
    return 'Los datos guardados son de una versión más nueva de la app. Cierra la app y vuelve a abrirla con internet para actualizarla.';
  }
  if (nombre === 'InvalidStateError' || nombre === 'UnknownError' || nombre === 'NotFoundError') {
    return 'La base de datos del navegador no está disponible ahora mismo. Cierra la app del todo y vuelve a abrirla. Si sigue pasando, reinicia el iPhone.';
  }
  if (nombre === 'DataError' || nombre === 'DataCloneError') {
    return 'Se intentó guardar un dato que no es válido (error de la app). No se ha guardado nada.';
  }
  return 'No se han podido guardar o leer los datos (' + (nombre || 'error desconocido') + '). Lo último que hiciste puede no haberse guardado.';
}

function aErrorBD(error) {
  return error instanceof ErrorBD ? error : new ErrorBD(mensajeParaUsuario(error), error);
}

/**
 * Crea un acceso a una base de datos. La app usa la de nombre "poker-estudio" (exportada
 * abajo como `bd`); los tests usan otra con otro nombre para no tocar tus datos.
 */
export function crearBD(nombre = NOMBRE) {
  let conexion = null; // promesa de la base de datos abierta (se abre una sola vez)

  function abrir() {
    if (conexion) return conexion;

    conexion = new Promise((resolver, rechazar) => {
      if (!('indexedDB' in self)) {
        rechazar(new ErrorBD('Este navegador no permite guardar datos (no tiene IndexedDB). Usa Safari en el iPhone.'));
        return;
      }

      // Si en 10 s no responde, avisamos en vez de esperar para siempre
      const espera = setTimeout(() => {
        rechazar(new ErrorBD('La base de datos no responde. Cierra la app del todo y vuelve a abrirla.'));
      }, 10000);

      let peticion;
      try {
        peticion = indexedDB.open(nombre, VERSION_BD);
      } catch (error) {
        clearTimeout(espera);
        rechazar(aErrorBD(error));
        return;
      }

      // Primera vez (o versión nueva): crear almacenes e índices
      peticion.onupgradeneeded = (evento) => {
        actualizarEstructura(peticion.result, evento.oldVersion);
      };

      peticion.onsuccess = () => {
        clearTimeout(espera);
        const bdNativa = peticion.result;
        // Si otra copia de la app (otra pestaña) necesita actualizar la estructura,
        // cerramos la nuestra para no bloquearla; la próxima operación la vuelve a abrir.
        bdNativa.onversionchange = () => {
          bdNativa.close();
          conexion = null;
        };
        resolver(bdNativa);
      };

      peticion.onerror = () => {
        clearTimeout(espera);
        rechazar(aErrorBD(peticion.error));
      };

      peticion.onblocked = () => {
        clearTimeout(espera);
        rechazar(new ErrorBD('La app está abierta en otra pestaña con una versión anterior. Ciérrala y vuelve a intentarlo.'));
      };
    });

    // Si falla al abrir, olvidamos la promesa para poder reintentar más tarde
    conexion.catch(() => { conexion = null; });
    return conexion;
  }

  /**
   * Ejecuta "trabajo" dentro de una transacción y espera a que termine.
   * Las escrituras solo se dan por buenas cuando la transacción se completa
   * (si falta espacio, el fallo llega al final, en "abort").
   */
  async function transaccion(almacenes, modo, trabajo) {
    const bdNativa = await abrir();
    return new Promise((resolver, rechazar) => {
      let resultado;
      let tx;
      try {
        tx = bdNativa.transaction(almacenes, modo);
        const peticion = trabajo(tx);
        if (peticion) peticion.onsuccess = () => { resultado = peticion.result; };
      } catch (error) {
        // Un fallo inmediato (p. ej. un objeto sin id): cancelar la transacción entera,
        // para que no se guarde nada de lo que ya se había pedido en ella
        if (tx) {
          try { tx.abort(); } catch { /* ya estaba terminada */ }
        }
        rechazar(aErrorBD(error));
        return;
      }
      tx.oncomplete = () => resolver(resultado);
      // Cualquier fallo dentro de la transacción la cancela ("abort") y llega aquí,
      // también el de "sin espacio", que a veces solo aparece al final
      tx.onabort = () => rechazar(aErrorBD(tx.error || new DOMException('Transacción cancelada', 'AbortError')));
    });
  }

  return {
    abrir,

    /** Guarda (crea o reemplaza) un objeto. Debe tener su clave (id, o clave en ajustes). */
    guardar(almacen, objeto) {
      return transaccion(almacen, 'readwrite', (tx) => tx.objectStore(almacen).put(objeto));
    },

    /** Guarda varios objetos a la vez: o se guardan todos, o ninguno. */
    guardarVarios(almacen, objetos) {
      return transaccion(almacen, 'readwrite', (tx) => {
        const a = tx.objectStore(almacen);
        for (const objeto of objetos) a.put(objeto);
      });
    },

    /** Lee un objeto por su clave. Devuelve undefined si no existe. */
    leer(almacen, clave) {
      return transaccion(almacen, 'readonly', (tx) => tx.objectStore(almacen).get(clave));
    },

    /** Lista todos los objetos de un almacén, o los que tienen un valor en un índice. */
    listar(almacen, indice, valor) {
      return transaccion(almacen, 'readonly', (tx) => {
        const a = tx.objectStore(almacen);
        return indice ? a.index(indice).getAll(valor) : a.getAll();
      });
    },

    /** Borra un objeto por su clave (si no existe, no pasa nada). */
    borrar(almacen, clave) {
      return transaccion(almacen, 'readwrite', (tx) => tx.objectStore(almacen).delete(clave));
    },

    /** Lee un ajuste; si no está guardado, devuelve el valor por defecto. */
    async leerAjuste(clave, porDefecto) {
      const fila = await this.leer('ajustes', clave);
      return fila === undefined ? porDefecto : fila.valor;
    },

    guardarAjuste(clave, valor) {
      return this.guardar('ajustes', { clave, valor });
    },

    /** Cierra la conexión (lo usan los tests antes de borrar su base de datos). */
    async cerrar() {
      if (!conexion) return;
      const bdNativa = await conexion;
      bdNativa.close();
      conexion = null;
    },
  };
}

/** Borra una base de datos entera (solo la usan los tests). */
export function borrarBaseDeDatos(nombre) {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.deleteDatabase(nombre);
    peticion.onsuccess = () => resolver();
    peticion.onerror = () => rechazar(aErrorBD(peticion.error));
    peticion.onblocked = () => resolver(); // se completará al cerrarse la conexión
  });
}

/**
 * Pide al navegador que NO borre los datos de la app por su cuenta (almacenamiento persistente).
 * Sin esto, Safari puede borrar los datos de webs y apps web si el iPhone se queda sin espacio.
 * Devuelve 'concedido', 'denegado' o 'no-disponible'.
 */
export async function pedirPersistencia() {
  if (!navigator.storage || !navigator.storage.persist) return 'no-disponible';
  try {
    if (await navigator.storage.persisted()) return 'concedido';
    return (await navigator.storage.persist()) ? 'concedido' : 'denegado';
  } catch {
    return 'no-disponible';
  }
}

/** Consulta (sin pedir nada) si el almacenamiento ya es persistente. */
export async function estadoPersistencia() {
  if (!navigator.storage || !navigator.storage.persisted) return 'no-disponible';
  try {
    return (await navigator.storage.persisted()) ? 'concedido' : 'denegado';
  } catch {
    return 'no-disponible';
  }
}

/** Espacio usado y disponible aproximado, en bytes, o null si el navegador no lo dice. */
export async function espacioUsado() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usado: usage, total: quota };
  } catch {
    return null;
  }
}

// La base de datos de la app
export const bd = crearBD();
