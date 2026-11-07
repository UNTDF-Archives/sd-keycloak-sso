# Arquitectura del Laboratorio de Máquinas Virtuales – Sistemas Distribuidos (UNTDF)

Este laboratorio recrea una infraestructura distribuida real en un entorno virtualizado local mediante **VirtualBox** (hipervisor Tipo 2), utilizando nodos con **Debian 12 (Bookworm)**. Su objetivo principal es permitir la experimentación con enrutamiento de red, mensajería asíncrona, sincronización de relojes físicos, resolución de nombres (DNS) y balanceo/virtual hosting HTTP en arquitecturas cliente-servidor y distribuidas.

---

## 1. Topología de Red y Roles de los Nodos

La infraestructura está compuesta por tres nodos principales organizados bajo una arquitectura perimetral con servidor bastión/gateway (`sdist0`) y una subred interna privada (`10.0.2.0/24`) completamente aislada del exterior:

```
                     [ Máquina Anfitriona (Host) ]
                                  |
              Red Host-Only (192.168.56.0/24) | SSH directo
                                  v
+-------------------------------------------------------------------+
|  sdist0 (Gateway / Bastión / Servidor Perimetral)                 |
|  - enp0s3: WAN / NAT (Salida a Internet)                          |
|  - enp0s9: Host-Only (192.168.56.10 - Administración SSH)         |
|  - enp0s8: LAN Interna (10.0.2.1 / 10.0.2.10 - Puerta de enlace)  |[cite: 61]
+-------------------------------------------------------------------+
                                  |
                    Red Interna (10.0.2.0/24)[cite: 88]
                    (Traducción NAT con nftables)
                                  +---------------------+
                                  |                     |
                                  v                     v
                +-------------------+ +-------------------+
                |  sdist1           | |  sdist2           |
                |  (Nodo Interno)   | |  (Nodo Interno)   |
                |  IP: 10.0.2.2/24  | |  IP: 10.0.2.3/24  |[cite: 88]
                |  GW: 10.0.2.1     | |  GW: 10.0.2.1     |
                +-------------------+ +-------------------+

```

### Tabla de especificaciones técnicas

| Nodo | Sistema Operativo | Interfaces de Red (VirtualBox) | Direcciones IP | Rol Principal en el Sistema |
| --- | --- | --- | --- | --- |
| **`sdist0`** | Debian 12 (Linux 6.x) | 1. NAT (enp0s3)<br>

<br>2. Red Interna (enp0s8)<br>

<br>3. Solo-Anfitrión (enp0s9) | • `192.168.1.x` (WAN)<br>

<br>• `10.0.2.1` / `10.0.2.10` (LAN)<br>

<br>• `192.168.56.10` (Admin)

 | Gateway perimetral, Bastión SSH, DNS autoritativo (Bind9) y Reverse Proxy/Web (Nginx).

 |
| **`sdist1`** | Debian 12 (Linux 6.x) | 1. Red Interna (`red_interna`) | • `10.0.2.2/24` (Estática)

<br>

<br>GW: `10.0.2.1` | Nodo de cómputo privado, broker/suscriptor y Servidor de Tiempo NTP (`chrony` Stratum 8).

 |
| **`sdist2`** | Debian 12 (Linux 6.x) | 1. Red Interna (`red_interna`) | • `10.0.2.3/24` (Estática)

<br>

<br>GW: `10.0.2.1` | Nodo de cómputo privado, worker concurrente, Cliente NTP (`chrony` Stratum 9) y cliente web/DNS.

 |

---

## 2. Enrutamiento, Seguridad y Salida a Internet

Los nodos privados `sdist1` y `sdist2` no tienen adaptadores conectados a Internet de forma directa. Su conectividad hacia el exterior se resuelve a nivel de Capa 3 en el gateway `sdist0`:

* **Reenvío de paquetes (IP Forwarding):** Activo en el kernel de `sdist0` mediante la directiva `net.ipv4.ip_forward = 1` en `/etc/sysctl.conf`.
* **Enmascaramiento NAT:** Gestionado mediante el subsistema nativo `nftables` en `sdist0`:
```nftables
table ip nat {
    chain postrouting {
        type nat hook postrouting priority 100 ;
        oifname "enp0s3" masquerade
    }
}

```


* **Resolución DNS en los clientes:** Configurada en `/etc/resolv.conf` apuntando inicialmente a resolvedores públicos (`8.8.8.8`, `1.1.1.1`) a través de la puerta de enlace `10.0.2.1`, y posteriormente al servidor local Bind9 en `10.0.2.10`.



---

## 3. Acceso y Administración Remota (SSH)

La máquina anfitriona se comunica exclusivamente con la interfaz *Host-Only* de `sdist0` (`192.168.56.10`). Para acceder a `sdist1` y `sdist2`, `sdist0` actúa como **Jump Host (Bastión)**.

### Configuración en el cliente anfitrión (`~/.ssh/config`)

```ssh-config
# Nodo Gateway / Bastión
Host sdist0
    HostName 192.168.56.10
    User lucas

# Nodos privados accesibles vía ProxyJump
Host sdist1
    HostName 10.0.2.2
    User lucas
    ProxyJump sdist0

Host sdist2
    HostName 10.0.2.3
    User lucas
    ProxyJump sdist0

```

* **Comandos de conexión directa:**
* Al Bastión: `ssh sdist0`
* A los nodos privados: `ssh sdist1` y `ssh sdist2` (el cliente SSH ejecuta automáticamente la tubería encriptada a través del bastión).



---

## 4. Servicios, Software y Prácticas Desarrolladas por Nodo

A lo largo del desarrollo de las prácticas de la materia, se configuraron componentes específicos en cada máquina:

### `sdist0` (Gateway / Core de Servicios Perimetrales)

1. **Infraestructura Base (TP1):** Ruteo de paquetes, masquerade de nftables y servicio SSH.
2. **Servidor DNS Autoritativo (TP8 - Bind9):**
* Paquetes: `bind9`, `bind9-utils`, `dnsutils`.


* Zona autoritativa directa: `distribuidos.net` declarada en `/etc/bind/named.conf.local`.


* Archivo de zona `/etc/bind/db.distribuidos.net`:


* Registro `A`: `www.distribuidos.net` apunta a `10.0.2.10`.


* Registros `CNAME`: `servicios` y `blog` configurados como alias apuntando a `www.distribuidos.net`.






3. **Servidor Web y Virtual Hosting (TP8 - Nginx):**
* Paquete: `nginx`.


* Virtual hosts basados en nombre (`server_name`) en `/etc/nginx/sites-available/distribuidos`:


* `www.distribuidos.net` sirviendo `/var/www/www`.


* `servicios.distribuidos.net` sirviendo `/var/www/servicios`.


* `blog.distribuidos.net` sirviendo `/var/www/blog`.




* El servidor desambigua las peticiones que llegan a la misma IP (`10.0.2.10`) analizando el header HTTP `Host` provisto por el cliente.





### `sdist1` (Servidor de Sincronización Temporal)

1. **Servidor NTP (TP7 - Chrony):**
* Configuración en `/etc/chrony/chrony.conf`:


* `local stratum 8`: Forzado de reloj local de hardware como estrato 8 autoritativo para operar sin conexión a estratos superiores (GPS/Internet).


* `allow 10.0.2.0/24`: Habilitación del servicio para toda la subred privada.


* Puerto UDP 123 en escucha.






2. **RabbitMQ / Mensajería (TP6):**
* Configuración de exchanges de tipo `topic` (`topic_stocks`) y pruebas de suscriptores con bindings jerárquicos (`stock.*.AAPL`, `stock.NYSE.*`, `stock.#`).





### `sdist2` (Cliente Temporal y Nodo Worker)

1. **Cliente NTP (TP7 - Chrony):**
* Configuración en `/etc/chrony/chrony.conf`:


* `server 10.0.2.2 iburst`: Sincronización exclusiva contra `sdist1`.


* Opera en `Stratum 9`.




* Verificación experimental de correcciones temporales:


* **Slew:** Variación continua de frecuencia en el oscilador para absorber desvíos pequeños (segundos) sin alterar la monotonía del tiempo.


* **Step:** Salto brusco del reloj del sistema ante desfases grandes (minutos).






2. **Workers Concurrentes (TP6):**
* Consumidores paralelos con `prefetch_count=1` (*fair dispatch*) y confirmaciones manuales (`basic_ack`) para la distribución equitativa de carga.





---

## 5. Instrucciones Rápidas de Operación para Modelos de Lenguaje

Al interactuar con este entorno o generar comandos para este laboratorio:

1. **Ejecución remota:** Los comandos para `sdist1` y `sdist2` deben asumir que el usuario accede mediante `ssh sdist1` o `ssh sdist2` (o a través del ProxyJump del bastión).
2. **Direccionamiento estricto:** El servidor web y DNS residen en `10.0.2.10` (`sdist0`), el servidor de tiempo reside en `10.0.2.2` (`sdist1`), y el nodo de pruebas/cliente de tiempo en `10.0.2.3` (`sdist2`).


3. **Persistencia y privilegios:** Las configuraciones de red, firewalls (`nftables`) y servicios del sistema (`chrony`, `named`, `nginx`) requieren privilegios de superusuario (`sudo`) y deben reflejarse en `/etc/` para ser persistentes.
