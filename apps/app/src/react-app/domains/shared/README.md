# domains/shared

跨域通用能力：agent registry、agent session state、env context、extension state、provider list query、status toasts、share workspace modal、provider auth modal。

## 定位
`shared` 是"下层"域：所有其他域都可以 import `shared`，`shared` 不能反向 import 任何业务域。

## 对外符号
只走 `./index.ts` barrel。
