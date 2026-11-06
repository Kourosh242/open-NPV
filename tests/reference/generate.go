package impl

// Synthetic differential-test fixtures for NPV Open. No real credentials.
// Run with OPENNPV_FIXTURE_OUT=/absolute/path go test ./internal/modules/impl -run TestGenerateOpenNPVFixtures -count=1

import (
    "bytes"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "encoding/binary"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "os"
    "path/filepath"
    "testing"
    "golang.org/x/crypto/chacha20poly1305"
    "golang.org/x/crypto/hkdf"
    "io"
)

func TestGenerateOpenNPVFixtures(t *testing.T) {
    out := os.Getenv("OPENNPV_FIXTURE_OUT")
    if out == "" { t.Skip("OPENNPV_FIXTURE_OUT not set") }
    if err := os.MkdirAll(out,0755); err != nil { t.Fatal(err) }
    uuid := "11111111-2222-4333-8444-555555555555"
    configs := []any{
      map[string]any{"name":"Synthetic VLESS · آزمایش","address":"example.invalid:443","v2rayProfile":map[string]any{
        "configType":5,"server":"example.invalid","serverPort":443,"password":uuid,"method":"none","network":"ws","host":"front.example.invalid","path":"/a?b=1&c=2","security":"tls","sni":"sni.example.invalid","alpn":"http/1.1","fingerPrint":"chrome","insecure":false}},
      map[string]any{"name":"REALITY","v2rayProfile":map[string]any{
        "configType":5,"server":"2001:db8::1","serverPort":8443,"password":uuid,"network":"tcp","security":"reality","sni":"www.example.invalid","fingerPrint":"chrome","publicKey":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","shortId":"","spiderX":"/test","flow":"xtls-rprx-vision"}},
      map[string]any{"name":"VMess فارسی","v2rayProfile":map[string]any{
        "configType":1,"server":"vmess.example.invalid","serverPort":443,"password":uuid,"method":"auto","alterId":0,"network":"grpc","serviceName":"svc","mode":"multi","security":"tls","sni":"vmess.example.invalid"}},
      map[string]any{"name":"Shadowsocks","v2rayProfile":map[string]any{
        "configType":3,"server":"ss.example.invalid","serverPort":8388,"password":"p@ss:/?# тест","method":"aes-256-gcm"}},
      map[string]any{"name":"Trojan","v2rayProfile":map[string]any{
        "configType":6,"server":"trojan.example.invalid","serverPort":443,"password":"p@ss:/?#","network":"ws","path":"/ws","security":"tls","sni":"trojan.example.invalid"}},
    }
    raw, _ := json.Marshal(map[string]any{"configs":configs})
    save := func(name string, data []byte, expected any, password string) {
      if err := os.WriteFile(filepath.Join(out,name),data,0600); err != nil { t.Fatal(err) }
      b,_ := json.MarshalIndent(expected,"","  ")
      if err := os.WriteFile(filepath.Join(out,name+".json"),b,0600); err != nil { t.Fatal(err) }
      t.Logf("fixture=%s bytes=%d sha256=%x password=%q",name,len(data),sha256.Sum256(data),password)
    }
    seal := func(key, nonce, plain, aad []byte) []byte {
      a,err:=chacha20poly1305.New(key); if err!=nil {t.Fatal(err)}
      return a.Seal(nil,nonce,plain,aad)
    }
    hk := func(ikm,salt []byte, info string) []byte {
      k:=make([]byte,32); if _,err:=io.ReadFull(hkdf.New(sha256.New,ikm,salt,[]byte(info)),k);err!=nil {t.Fatal(err)};return k
    }
    b32 := func(n int) []byte {
      b:=bytes.Repeat([]byte{0x2a},n)
      for i:=range b {b[i]=byte((i*17+11)%256)}
      return b
    }
    var vectors [][2]string
    for i:=0;i<24;i++ {salt:=b32(16);salt[0]=byte(i);a,err:=npvGen2A16(salt);if err!=nil {t.Fatal(err)};vectors=append(vectors,[2]string{hex.EncodeToString(salt[:]),hex.EncodeToString(a[:])})}
    vb,_:=json.MarshalIndent(vectors,"","  ");os.WriteFile(filepath.Join(out,"gen2-vectors.json"),vb,0600)

    for _, mode := range []string{"pass","app"} {
      salt:=b32(16); nonce:=b32(12); configID:=b32(16); contentID:=b32(32)
      dek:=b32(32)
      var kdk []byte
      prefix:=[]byte{1};prefix=append(prefix,configID...);prefix=append(prefix,make([]byte,33)...);prefix=append(prefix,0,0,0)
      if mode=="pass" {
        prefix[50]=1;kdk=customPBKDF2HmacSha256([]byte("رمز آزمایشی 123"),salt,1000,32)
        prefix=append(prefix,0,0,3,0xe8);prefix=append(prefix,salt...)
      } else {
        prefix[50]=2;a,err:=npvGen2A16(salt);if err!=nil {t.Fatal(err)};sum:=npvGen2KDK(a,configID);kdk=sum[:]
        prefix=append(prefix,0,2);prefix=append(prefix,salt...)
      }
      wrapNonce:=b32(12);prefix=append(prefix,wrapNonce...);prefix=append(prefix,seal(kdk,wrapNonce,dek,salt)...)
      meta:=[]byte(`{"issuedAt":"2026-01-01T00:00:00Z","policy":{"configVersion":1,"onlyMobileNetwork":false}}`)
      metaSealed:=seal(hk(dek,nonce,npvGen2MetadataInfo),nonce,meta,prefix)
      ml:=make([]byte,4);binary.BigEndian.PutUint32(ml,uint32(len(metaSealed)));header:=append(prefix,ml...);header=append(header,metaSealed...)
      type row struct {seq uint16; plain []byte}
      var rows []row;seq:=uint16(1)
      var replace func(any) any
      replace=func(v any) any {
        switch x:=v.(type) {
        case map[string]any:
          o:=map[string]any{};for k,z:=range x {o[k]=replace(z)};return o
        case []any:
          o:=make([]any,len(x));for i,z:=range x {o[i]=replace(z)};return o
        default:
          b,_:=json.Marshal(v);rows=append(rows,row{seq,b});r:=float64(seq);seq++;return r
        }
      }
      refs:=replace(configs)
      table,_:=json.Marshal(map[string]any{"configs":refs});rows=append(rows,row{65535,table})
      body:=[]byte("NPF\x01");body=append(body,contentID...);body=append(body,byte(len(rows)>>8),byte(len(rows)))
      for _,r:=range rows {
        key:=hk(dek,contentID,npvGen2FieldKeyInfo+string(npvGen2BE16Bytes(r.seq)))
        aad:=append([]byte(npvGen2RecordAADInfo),contentID...);aad=append(aad,npvGen2BE16Bytes(r.seq)...);aad=append(aad,npvGen2BE32Bytes(uint32(len(r.plain)))...)
        ct:=seal(key,make([]byte,12),r.plain,aad)
        body=append(body,npvGen2BE16Bytes(r.seq)...);body=append(body,0,0);body=append(body,npvGen2BE16Bytes(uint16(len(ct)))...);body=append(body,ct...)
      }
      file:=[]byte("NPVS\x05");hl:=make([]byte,4);binary.BigEndian.PutUint32(hl,uint32(len(header)));file=append(file,hl...);file=append(file,header...);file=append(file,nonce...);bl:=make([]byte,4);binary.BigEndian.PutUint32(bl,uint32(len(body)));file=append(file,bl...);file=append(file,body...);file=append(file,make([]byte,64)...)
      fields:=map[uint16][]byte{};for _,r:=range rows {fields[r.seq]=r.plain}
      expected:=npvGen2Substitute(refs,fields)
      pass:="";if mode=="pass" {pass="رمز آزمایشی 123"}
      save("synthetic-v5-"+mode+".npvs",file,expected,pass)
    }

    // NPVS v1, both white-box variants and passphrase unwrap.
    for _, mode:=range []string{"app-v1","app-v2","pass"} {
      salt:=b32(16);nonce:=b32(12);dek:=b32(32)
      var kdk []byte
      if mode=="pass" {kdk=customPBKDF2HmacSha256([]byte("synthetic password"),salt,1000,32)} else {
        ks:=custodianKDKs(salt);idx:=0;if mode=="app-v2" {idx=1};kdk=ks[idx]
      }
      wrapNonce:=b32(12);wrap:=append(wrapNonce,seal(kdk,wrapNonce,dek,salt)...)
      h:=map[string]any{"v":1,"configId":"synthetic","policy":map[string]any{"configVersion":1}}
      w:=map[string]any{"salt":base64.RawURLEncoding.EncodeToString(salt),"wrap":base64.RawURLEncoding.EncodeToString(wrap)}
      if mode=="pass" {w["kdf"]="pbkdf2-hmac-sha256";w["iters"]=1000;h["passphrase"]=w} else {w["kdf"]="wbaes-ctr-sha256";w["keyId"]=1;h["appKey"]=w}
      hb,_:=json.Marshal(h);ct:=seal(dek,nonce,raw,hb)
      file:=[]byte("NPVS\x01");hl:=make([]byte,4);binary.BigEndian.PutUint32(hl,uint32(len(hb)));file=append(file,hl...);file=append(file,hb...);file=append(file,nonce...);bl:=make([]byte,4);binary.BigEndian.PutUint32(bl,uint32(len(ct)));file=append(file,bl...);file=append(file,ct...);file=append(file,make([]byte,64)...)
      pass:="";if mode=="pass" {pass="synthetic password"}
      save("synthetic-v1-"+mode+".npvs",file,configs,pass)
    }
    nonce:=make([]byte,16);for i:=8;i<16;i++ {nonce[i]=0xff}
    blob:=append(nonce,ctrCrypt([16]byte(nonce),raw)...)
    file:=[]byte("NPVT1\n"+base64.StdEncoding.EncodeToString(blob))
    save("synthetic.npvt",file,configs,"")
    // Independent random-data CTR vectors, including partial blocks.
    var ctrVectors []map[string]string
    for _,variant:=range []string{"npvt","v1","v2"} {
      for n:=0;n<40;n++ {
        input:=make([]byte,n);rand.Read(input);counter:=b32(16);counter[15]=byte(n)
        var output []byte
        if variant=="npvt" {output=ctrCrypt([16]byte(counter),input)} else {last:=&wbTlastV1;if variant=="v2" {last=&wbTlastV2};output=wbCTR(counter,input,last)}
        ctrVectors=append(ctrVectors,map[string]string{"variant":variant,"nonce":hex.EncodeToString(counter),"input":hex.EncodeToString(input),"output":hex.EncodeToString(output)})
      }
    }
    cv,_:=json.MarshalIndent(ctrVectors,"","  ");os.WriteFile(filepath.Join(out,"ctr-vectors.json"),cv,0600)
    fmt.Println("Synthetic fixtures generated; no real configuration data used.")
}
