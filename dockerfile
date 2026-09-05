FROM postgres:18-alpine

COPY pg_hba.conf /etc/postgresql/pg_hba.conf
COPY init-auth.sql /docker-entrypoint-initdb.d/10-auth.sql

CMD ["postgres", "-c", "hba_file=/etc/postgresql/pg_hba.conf"]