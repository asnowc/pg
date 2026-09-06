CREATE DATABASE auth_test;

SET password_encryption = 'md5';
CREATE ROLE auth_password LOGIN PASSWORD 'password-secret';

SET password_encryption = 'scram-sha-256';
CREATE ROLE auth_trust LOGIN PASSWORD 'trust-password-is-ignored';
CREATE ROLE auth_scram LOGIN PASSWORD 'scram-secret';
CREATE ROLE auth_tls LOGIN PASSWORD 'tls-secret';

GRANT CONNECT ON DATABASE auth_test TO auth_trust, auth_password, auth_scram, auth_tls;