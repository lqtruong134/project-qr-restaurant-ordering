-- Run in thesis_dev (project PostgreSQL at localhost:5433).
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename;
SELECT u.username,u.display_name,u.status,r.code AS role,p.code AS permission
FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
JOIN role r ON r.id=ur.role_id JOIN role_permission rp ON rp.role_id=r.id
JOIN permission p ON p.id=rp.permission_id ORDER BY u.username;
SELECT t.code,t.table_status,s.session_status,s.verification_status,c.cart_version
FROM dining_table t LEFT JOIN table_session s ON s.table_id=t.id AND s.session_status='ACTIVE'
LEFT JOIN session_cart c ON c.session_id=s.id ORDER BY t.code;
SELECT p.code,p.name,c.name AS category,p.base_price,p.availability_status
FROM product p JOIN menu_category c ON c.id=p.category_id ORDER BY p.code;
