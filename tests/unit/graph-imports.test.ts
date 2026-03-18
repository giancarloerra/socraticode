// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { Lang } from "@ast-grep/napi";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureDynamicLanguages } from "../../src/services/code-graph.js";
import { extractImports } from "../../src/services/graph-imports.js";

// Register dynamic language grammars once before all tests
beforeAll(() => {
  ensureDynamicLanguages();
});

describe("graph-imports", () => {
  // ── TypeScript / JavaScript ────────────────────────────────────────────

  describe("TypeScript/JavaScript imports", () => {
    it("extracts static imports", () => {
      const source = `
import { foo } from "./utils.js";
import bar from "../lib/bar.js";
import * as helpers from "./helpers.js";
`;
      const imports = extractImports(source, Lang.TypeScript, ".ts");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("./utils.js");
      expect(specs).toContain("../lib/bar.js");
      expect(specs).toContain("./helpers.js");
    });

    it("extracts dynamic imports", () => {
      const source = `
const mod = await import("./dynamic-module.js");
`;
      const imports = extractImports(source, Lang.TypeScript, ".ts");
      const dynamicImports = imports.filter((i) => i.isDynamic);

      expect(dynamicImports.length).toBeGreaterThanOrEqual(1);
      expect(
        dynamicImports.some((i) => i.moduleSpecifier === "./dynamic-module.js"),
      ).toBe(true);
    });

    it("extracts require() calls", () => {
      const source = `
const fs = require("fs");
const local = require("./local-module");
`;
      const imports = extractImports(source, Lang.JavaScript, ".js");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("fs");
      expect(specs).toContain("./local-module");
    });

    it("extracts re-exports", () => {
      const source = `
export { default } from "./base.js";
export * from "./all.js";
`;
      const imports = extractImports(source, Lang.TypeScript, ".ts");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("./base.js");
      expect(specs).toContain("./all.js");
    });

    it("handles empty source", () => {
      const imports = extractImports("", Lang.TypeScript, ".ts");
      expect(imports).toHaveLength(0);
    });

    it("handles source with no imports", () => {
      const source = `
function hello() {
  return "world";
}
`;
      const imports = extractImports(source, Lang.TypeScript, ".ts");
      expect(imports).toHaveLength(0);
    });
  });

  // ── Svelte ──────────────────────────────────────────────────────────────

  describe("Svelte imports", () => {
    it("extracts imports from <script> blocks", () => {
      const source = `
<script lang="ts">
  import { onMount } from "svelte";
  import Button from "./Button.svelte";
  import { type Props } from "../types.js";
</script>

<Button>Click me</Button>
`;
      const imports = extractImports(source, "svelte", ".svelte");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("svelte");
      expect(specs).toContain("./Button.svelte");
      expect(specs).toContain("../types.js");
    });

    it("extracts imports from <script module> blocks", () => {
      const source = `
<script lang="ts" module>
  export type Variant = "primary" | "secondary";
  export { default as Button } from "./Button.svelte";
</script>

<script lang="ts">
  import { onMount } from "svelte";
</script>

<div>content</div>
`;
      const imports = extractImports(source, "svelte", ".svelte");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("./Button.svelte");
      expect(specs).toContain("svelte");
    });

    it("extracts dynamic imports from Svelte files", () => {
      const source = `
<script lang="ts">
  const Component = await import("./DynamicComponent.svelte");
</script>
`;
      const imports = extractImports(source, "svelte", ".svelte");
      const dynamicImports = imports.filter((i) => i.isDynamic);

      expect(dynamicImports.length).toBeGreaterThanOrEqual(1);
      expect(
        dynamicImports.some(
          (i) => i.moduleSpecifier === "./DynamicComponent.svelte",
        ),
      ).toBe(true);
    });

    it("handles Svelte files with no script block", () => {
      const source = `
<div>Just markup, no script</div>
<style>
  div { color: red; }
</style>
`;
      const imports = extractImports(source, "svelte", ".svelte");
      expect(imports).toHaveLength(0);
    });

    it("handles Svelte files with JavaScript (no lang=ts)", () => {
      const source = `
<script>
  import { writable } from "svelte/store";
  import Item from "./Item.svelte";
</script>
`;
      const imports = extractImports(source, "svelte", ".svelte");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("svelte/store");
      expect(specs).toContain("./Item.svelte");
    });
  });

  // ── Vue ────────────────────────────────────────────────────────────────

  describe("Vue imports", () => {
    it("extracts imports from <script> blocks", () => {
      const source = `
<script lang="ts">
  import { ref, computed } from "vue";
  import MyComponent from "./MyComponent.vue";
</script>

<template>
  <MyComponent />
</template>
`;
      const imports = extractImports(source, "vue", ".vue");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("vue");
      expect(specs).toContain("./MyComponent.vue");
    });
  });

  // ── Python ─────────────────────────────────────────────────────────────

  describe("Python imports", () => {
    it("extracts import statements", () => {
      const source = `
import os
import json
from typing import List, Dict
from .models import User
from ..utils import helpers
`;
      const imports = extractImports(source, "python", ".py");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("os");
      expect(specs).toContain("json");
      expect(specs).toContain("typing");
      expect(specs).toContain(".models");
      expect(specs).toContain("..utils");
    });
  });

  // ── Java ───────────────────────────────────────────────────────────────

  describe("Java imports", () => {
    it("extracts import declarations", () => {
      const source = `
package com.example;

import java.util.List;
import com.example.models.User;
import static java.lang.Math.PI;
`;
      const imports = extractImports(source, "java", ".java");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThan(0);
      // Should capture the import paths
      expect(specs.some((s) => s.includes("java.util"))).toBe(true);
    });
  });

  // ── Rust ───────────────────────────────────────────────────────────────

  describe("Rust imports", () => {
    it("extracts use statements", () => {
      const source = `
use std::collections::HashMap;
use crate::models::User;
mod config;
`;
      const imports = extractImports(source, "rust", ".rs");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThan(0);
    });
  });

  // ── Go ─────────────────────────────────────────────────────────────────

  describe("Go imports", () => {
    it("extracts import declarations", () => {
      const source = `
package main

import (
    "fmt"
    "os"
    "github.com/user/repo/internal/utils"
)
`;
      const imports = extractImports(source, "go", ".go");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThan(0);
      expect(specs.some((s) => s.includes("fmt"))).toBe(true);
    });
  });

  // ── Dart (regex-based) ─────────────────────────────────────────────────

  describe("Dart imports (regex)", () => {
    it("extracts import statements", () => {
      const source = `
import 'package:flutter/material.dart';
import 'dart:async';
import '../utils/helpers.dart';
export 'models.dart';
`;
      const imports = extractImports(source, "dart", ".dart");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("package:flutter/material.dart");
      expect(specs).toContain("dart:async");
      expect(specs).toContain("../utils/helpers.dart");
      expect(specs).toContain("models.dart");
    });

    it("extracts part statements", () => {
      const source = `
part 'src/model.dart';
part 'src/widget.dart';
`;
      const imports = extractImports(source, "dart", ".dart");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("src/model.dart");
      expect(specs).toContain("src/widget.dart");
    });
  });

  // ── Lua (regex-based) ──────────────────────────────────────────────────

  describe("Lua imports (regex)", () => {
    it("extracts require calls", () => {
      const source = `
local http = require("socket.http")
local json = require 'cjson'
`;
      const imports = extractImports(source, "lua", ".lua");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("socket.http");
      expect(specs).toContain("cjson");
    });

    it("extracts dofile/loadfile calls", () => {
      const source = `
dofile("config.lua")
loadfile("data.lua")
`;
      const imports = extractImports(source, "lua", ".lua");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("config.lua");
      expect(specs).toContain("data.lua");
    });
  });

  // ── PHP ────────────────────────────────────────────────────────────────

  describe("PHP imports", () => {
    it("extracts use statements", () => {
      const source = `<?php
namespace App\\Controllers;

use App\\Models\\User;
use Illuminate\\Http\\Request;
require_once './config.php';
include './helpers.php';
`;
      const imports = extractImports(source, "php", ".php");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("App\\Models\\User");
      expect(specs).toContain("Illuminate\\Http\\Request");
      expect(specs).toContain("./config.php");
      expect(specs).toContain("./helpers.php");
    });

    it("extracts use with alias", () => {
      const source = `<?php
use App\\Models\\User as UserModel;
use App\\Services\\PaymentService as Payment;
`;
      const imports = extractImports(source, "php", ".php");
      const specs = imports.map((i) => i.moduleSpecifier);

      // Should extract the namespace, not the alias
      expect(specs).toContain("App\\Models\\User");
      expect(specs).toContain("App\\Services\\PaymentService");
      expect(specs).not.toContain("App\\Models\\User as UserModel");
    });

    it("extracts grouped use statements", () => {
      const source = `<?php
use App\\Models\\{User, Post, Comment};
`;
      const imports = extractImports(source, "php", ".php");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("App\\Models\\User");
      expect(specs).toContain("App\\Models\\Post");
      expect(specs).toContain("App\\Models\\Comment");
    });

    it("extracts use function and use const", () => {
      const source = `<?php
use function App\\Helpers\\formatDate;
use const App\\Config\\MAX_RETRIES;
`;
      const imports = extractImports(source, "php", ".php");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("App\\Helpers\\formatDate");
      expect(specs).toContain("App\\Config\\MAX_RETRIES");
    });
  });

  // ── Ruby ───────────────────────────────────────────────────────────────

  describe("Ruby imports", () => {
    it("extracts require statements", () => {
      const source = `
require 'json'
require_relative './models/user'
require_relative '../lib/helpers'
`;
      const imports = extractImports(source, "ruby", ".rb");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThan(0);
    });
  });

  // ── C/C++ ──────────────────────────────────────────────────────────────

  describe("C/C++ imports", () => {
    it("extracts include directives", () => {
      const source = `
#include <stdio.h>
#include "local_header.h"
#include "../utils/math.h"
`;
      const imports = extractImports(source, "c", ".c");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThan(0);
    });
  });

  // ── Shell/Bash ─────────────────────────────────────────────────────────

  describe("Shell imports", () => {
    it("extracts source commands", () => {
      const source = `
#!/bin/bash
source ./config.sh
. ./utils.sh
`;
      const imports = extractImports(source, "bash", ".sh");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThan(0);
    });
  });

  // ── Kotlin ──────────────────────────────────────────────────────────────

  describe("Kotlin imports", () => {
    it("extracts import headers", () => {
      const source = `
package com.example.app

import com.example.models.User
import com.example.utils.StringHelper
import kotlinx.coroutines.launch
`;
      const imports = extractImports(source, "kotlin", ".kt");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThanOrEqual(3);
      expect(specs.some((s) => s.includes("com.example.models.User"))).toBe(
        true,
      );
      expect(
        specs.some((s) => s.includes("com.example.utils.StringHelper")),
      ).toBe(true);
    });

    it("handles wildcard imports", () => {
      const source = `
import com.example.models.*
`;
      const imports = extractImports(source, "kotlin", ".kt");

      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(
        imports.some((i) => i.moduleSpecifier.includes("com.example.models")),
      ).toBe(true);
    });
  });

  // ── Scala ───────────────────────────────────────────────────────────────

  describe("Scala imports", () => {
    it("extracts import declarations", () => {
      const source = `
package com.example

import scala.collection.mutable.ListBuffer
import com.example.models.User
import com.example.services._
`;
      const imports = extractImports(source, "scala", ".scala");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThanOrEqual(2);
      expect(
        specs.some(
          (s) => s.includes("scala.collection") || s.includes("ListBuffer"),
        ),
      ).toBe(true);
    });
  });

  // ── Swift ───────────────────────────────────────────────────────────────

  describe("Swift imports", () => {
    it("extracts import declarations", () => {
      const source = `
import Foundation
import UIKit
import SwiftUI
`;
      const imports = extractImports(source, "swift", ".swift");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThanOrEqual(3);
      expect(specs).toContain("Foundation");
      expect(specs).toContain("UIKit");
      expect(specs).toContain("SwiftUI");
    });

    it("handles no imports", () => {
      const source = `
func hello() -> String {
    return "world"
}
`;
      const imports = extractImports(source, "swift", ".swift");
      expect(imports).toHaveLength(0);
    });
  });

  // ── C# ─────────────────────────────────────────────────────────────────

  describe("C# imports", () => {
    it("extracts using directives", () => {
      const source = `
using System;
using System.Collections.Generic;
using MyApp.Models;
`;
      const imports = extractImports(source, "csharp", ".cs");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.length).toBeGreaterThanOrEqual(3);
      expect(specs.some((s) => s.includes("System"))).toBe(true);
      expect(specs.some((s) => s.includes("MyApp.Models"))).toBe(true);
    });

    it("extracts static using directives", () => {
      const source = `
using static System.Math;
`;
      const imports = extractImports(source, "csharp", ".cs");

      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(
        imports.some((i) => i.moduleSpecifier.includes("System.Math")),
      ).toBe(true);
    });

    it("skips using alias directives", () => {
      const source = `
using Alias = System.Collections.Generic.List<int>;
`;
      const imports = extractImports(source, "csharp", ".cs");
      // Using aliases (using X = ...) should be filtered out
      expect(imports).toHaveLength(0);
    });
  });
});
