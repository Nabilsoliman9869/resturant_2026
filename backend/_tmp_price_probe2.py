from api_server import get_connection
c=get_connection(); cur=c.cursor()
cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TBL007' ORDER BY ORDINAL_POSITION")
cols=[r[0] for r in cur.fetchall()]
print('COLS_COUNT', len(cols))
print('PRICE_COLS', [x for x in cols if ('price' in x.lower()) or ('cost' in x.lower()) or ('value' in x.lower())])
cur.execute("SELECT TOP 20 ProductName, EndUserPrice, AgentPrice FROM TBL007 WHERE ProductName IS NOT NULL ORDER BY ProductName")
rows=cur.fetchall()
for r in rows:
    print(r[0], '=>', r[1], r[2])
c.close()
