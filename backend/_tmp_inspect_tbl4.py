from api_server import get_connection
c=get_connection();cur=c.cursor()
cur.execute("SELECT COLUMN_NAME,DATA_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TBL004' ORDER BY ORDINAL_POSITION")
for r in cur.fetchall():
    print(r[0], r[1], r[2], r[3])
print('--- TBL002 top ---')
cur.execute('SELECT TOP 5 * FROM TBL002')
cols=[d[0] for d in cur.description]
for row in cur.fetchall():
    m=dict(zip(cols,row))
    print({k:m.get(k) for k in cols[:6]})
c.close()
