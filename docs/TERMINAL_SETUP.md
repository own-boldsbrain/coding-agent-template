# VS Code Terminal Shell Integration - Setup Completo

**Data de configuração:** 23 de novembro de 2025  
**Ambiente:** Windows + PowerShell (pwsh)

## 📋 Resumo das Configurações Aplicadas

### 1. PowerShell Profile
- **Localização:** `C:\Users\fjuni\OneDrive\Documentos\PowerShell\Microsoft.PowerShell_profile.ps1`
- **Status:** ✅ Criado e configurado
- **Método:** Sourcing dinâmico do script de shell integration (portável)

### 2. VS Code Settings
- **Localização:** `.vscode/settings.json`
- **Status:** ✅ 16 configurações de terminal aplicadas
- **Foco:** Máxima performance e produtividade

## 🚀 Recursos Ativados

### Shell Integration Features
- ✅ **Command Decorations:** Círculos coloridos indicando sucesso/falha de comandos
- ✅ **Command Navigation:** Ctrl+Up/Down para navegar entre comandos
- ✅ **Sticky Scroll:** Comando atual fixo no topo do terminal
- ✅ **Quick Fixes:** Sugestões contextuais para erros comuns
- ✅ **Run Recent Command:** Ctrl+Alt+R para histórico inteligente
- ✅ **Go to Recent Directory:** Ctrl+G para navegação rápida
- ✅ **Command Guide:** Barra visual identificando limites de comandos

### IntelliSense Terminal
- ✅ **Sugestões automáticas** para comandos, arquivos e argumentos
- ✅ **Trigger characters:** Sugestões após `-` e `/`
- ✅ **Inline suggestions:** Ghost text no terminal
- ✅ **Cache de 2000 itens** de histórico

### Performance
- ✅ **GPU Acceleration:** Auto (otimizado)
- ✅ **Smooth Scrolling:** Desabilitado (melhor performance)
- ✅ **Scrollback:** 5000 linhas (balanceado)

## 🧪 Como Testar

### 1. Abrir Novo Terminal
```powershell
# Pressione Ctrl+Shift+` para novo terminal
# O profile será carregado automaticamente
```

### 2. Verificar Shell Integration Quality
- Hover sobre a **aba do terminal**
- Deve mostrar: "Shell integration quality: **Rich**"

### 3. Testar Decorações
```powershell
# Comando que funciona (deve aparecer círculo azul)
Get-Date

# Comando que falha (deve aparecer círculo vermelho com X)
Get-Item "arquivo_inexistente.txt"
```

### 4. Testar Navegação
```powershell
# Execute vários comandos, depois:
# Ctrl+Up - Comando anterior
# Ctrl+Down - Próximo comando
# Shift+Ctrl+Up - Seleciona até comando anterior
```

### 5. Testar Run Recent Command
```powershell
# Pressione Ctrl+Alt+R
# Deve abrir Quick Pick com histórico de comandos
```

### 6. Verificar Variáveis de Ambiente
```powershell
# Deve retornar "vscode"
$env:TERM_PROGRAM

# Deve estar definida em novos terminais
$env:VSCODE_SHELL_INTEGRATION
```

## ⚙️ Configurações Aplicadas

### Terminal Integration
```json
"terminal.integrated.shellIntegration.enabled": true
"terminal.integrated.shellIntegration.decorationsEnabled": "both"
"terminal.integrated.shellIntegration.showCommandGuide": true
"terminal.integrated.stickyScroll.enabled": true
"terminal.integrated.shellIntegration.history": 2000
```

### Performance
```json
"terminal.integrated.gpuAcceleration": "auto"
"terminal.integrated.scrollback": 5000
"terminal.integrated.smoothScrolling": false
"terminal.integrated.enableFileLinks": true
```

### IntelliSense
```json
"terminal.integrated.suggest.enabled": true
"terminal.integrated.suggest.quickSuggestions": true
"terminal.integrated.suggest.suggestOnTriggerCharacters": true
"terminal.integrated.suggest.runOnEnter": false
"terminal.integrated.suggest.inlineSuggestion": true
```

## 🔧 Manutenção

### Atualizar Cache de Sugestões
Se adicionar novos comandos/aliases ao profile:
```
Command Palette (Ctrl+Shift+P) → "Terminal: Clear Suggest Cached Globals"
```

### Atualizar Profile
Edite o profile:
```powershell
code $PROFILE
```

### Verificar Profile
```powershell
# Localização
$PROFILE

# Conteúdo
Get-Content $PROFILE

# Testar profile
. $PROFILE
```

## 🐛 Troubleshooting

### Shell Integration não aparece
1. Verifique se está em um **novo terminal** (Ctrl+Shift+`)
2. Confirme `$env:TERM_PROGRAM` = "vscode"
3. Verifique se o profile foi carregado: `Test-Path $PROFILE`

### Decorações pulando (Windows)
- Normal devido ao ConPTY (emulador de terminal do Windows)
- VS Code usa heurísticas para corrigir posicionamento
- Alternativa: Configure `"decorationsEnabled": "never"` se incomodar

### Latência ao abrir terminal
- Profile usa sourcing dinâmico (chama `code` em cada terminal)
- Para máxima performance: considere **inline** do script
- Trade-off: inline requer manutenção manual em atualizações do VS Code

### Links não funcionam
```json
// Desabilite se causar problemas de performance
"terminal.integrated.enableFileLinks": false
```

## 📚 Atalhos Úteis

| Atalho | Ação |
|--------|------|
| `Ctrl+`` | Toggle terminal |
| `Ctrl+Shift+`` | Novo terminal |
| `Ctrl+Alt+R` | Run Recent Command |
| `Ctrl+G` | Go to Recent Directory |
| `Ctrl+Up/Down` | Navegar comandos |
| `Shift+Ctrl+Up/Down` | Selecionar até comando |
| `Ctrl+Shift+O` | Open Detected Link |
| `Ctrl+F` | Find no terminal |

## 📖 Referências

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [VS Code Terminal Basics](https://code.visualstudio.com/docs/editor/integrated-terminal)
- [PowerShell Profiles](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles)

## ✅ Status Final

- ✅ PowerShell profile criado e configurado
- ✅ 16 configurações de terminal otimizadas aplicadas
- ✅ Shell integration pronta para uso
- ✅ Documentação completa criada

**Próximo passo:** Abra um novo terminal (Ctrl+Shift+`) e aproveite os recursos!
