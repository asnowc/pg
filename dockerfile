FROM postgres:18-alpine

COPY pg_hba.conf /etc/postgresql/pg_hba.conf
COPY init-auth.sql /docker-entrypoint-initdb.d/10-auth.sql
COPY --chown=postgres:postgres test/fixtures/tls/server.crt /var/lib/postgresql/server.crt
COPY --chown=postgres:postgres test/fixtures/tls/server.key /var/lib/postgresql/server.key
COPY --chown=postgres:postgres test/fixtures/tls/ca.crt /var/lib/postgresql/ca.crt
RUN chmod 0600 /var/lib/postgresql/server.key \
	&& chmod 0644 /var/lib/postgresql/server.crt /var/lib/postgresql/ca.crt

CMD ["postgres", "-c", "hba_file=/etc/postgresql/pg_hba.conf", "-c", "ssl=on", "-c", "ssl_cert_file=/var/lib/postgresql/server.crt", "-c", "ssl_key_file=/var/lib/postgresql/server.key", "-c", "ssl_ca_file=/var/lib/postgresql/ca.crt"]