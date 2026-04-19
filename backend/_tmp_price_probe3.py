from api_server import get_connection
names=[
'cordon bleu','fajita sandwish chicken','half duck','ستيك مشوي','كباب مشوى Kebab','سمان مشوى Grild Quail'
]
price_cols=['EndUserPrice','AgentPrice','WholePrice','Price5Item','Price6Item','Price7Item','Value','Value2','Value3']
c=get_connection(); cur=c.cursor()
for n in names:
    cur.execute("SELECT TOP 1 * FROM TBL007 WHERE ProductName = ?", (n,))
    row=cur.fetchone()
    if not row:
        cur.execute("SELECT TOP 1 * FROM TBL007 WHERE ProductName LIKE ?", ('%'+n+'%',))
        row=cur.fetchone()
    print('\n===',n,'FOUND',bool(row),'===')
    if not row:
        continue
    m=dict(zip([d[0] for d in cur.description], row))
    for k in price_cols:
        if k in m:
            print(k, '=>', m.get(k))
    nz=[(k,m.get(k)) for k in m.keys() if ('price' in k.lower() or 'value' in k.lower()) and str(m.get(k) or '0') not in ('0','0.0','0.00')]
    print('NON_ZERO_PRICE_COLS', nz[:8])

# overall which columns have data
cur.execute("SELECT TOP 2000 * FROM TBL007 WHERE ProductName IS NOT NULL")
rows=cur.fetchall(); cols=[d[0] for d in cur.description]
price_keys=[k for k in cols if ('price' in k.lower() or 'value' in k.lower())]
nonzero={k:0 for k in price_keys}
for r in rows:
    m=dict(zip(cols,r))
    for k in price_keys:
        v=m.get(k)
        try:
            if v is not None and float(v)!=0:
                nonzero[k]+=1
        except Exception:
            pass
print('\nTOP NONZERO PRICE COLUMNS:')
for k,v in sorted(nonzero.items(), key=lambda x:x[1], reverse=True)[:12]:
    print(k,v)

c.close()
