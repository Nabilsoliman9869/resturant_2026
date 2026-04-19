from backend.api_server import get_connection
c=get_connection(); cur=c.cursor()
cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TBL007' ORDER BY ORDINAL_POSITION")
cols=[r[0] for r in cur.fetchall()]
print('COLS_COUNT', len(cols))
print('COLS', cols)

cur.execute("SELECT TOP 30 ProductName, EndUserPrice, AgentPrice FROM TBL007 WHERE ProductName IS NOT NULL ORDER BY ProductName")
rows=cur.fetchall()
print('SAMPLE_ROWS', len(rows))
for r in rows[:15]:
    print(r[0], '=> EndUserPrice=', r[1], 'AgentPrice=', r[2])

cur.execute("SELECT TOP 1 * FROM TBL007 WHERE ProductName LIKE N'%cordon bleu%'")
row=cur.fetchone()
print('CORDON_FOUND', bool(row))
if row:
    m=dict(zip([d[0] for d in cur.description], row))
    keys=[k for k in m.keys() if ('price' in k.lower()) or ('cost' in k.lower()) or ('value' in k.lower()) or k.lower() in ('hieght1','hieght2','hieght3')]
    print('PRICE_KEYS', keys)
    for k in keys:
        print(k, '=>', m.get(k))
c.close()
