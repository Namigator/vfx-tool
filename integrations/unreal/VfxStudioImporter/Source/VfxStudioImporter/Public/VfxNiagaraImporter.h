#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "VfxNiagaraImporter.generated.h"

/**
 * Reads a VFX Studio Unreal export package (effect.json + Textures/*.png, written by
 * src/export/unreal/package.ts in the VFX-Tool repo) and builds a NiagaraSystem under DestPath:
 * imports textures, builds (once, shared) Additive/Translucent sprite materials and one Material
 * Instance Constant per texture, adds one emitter per IR emitter from the closest stock Niagara
 * template (effect.json emitter field "suggestedTemplate") and sets its module inputs from real,
 * UE 5.8-verified module/input names (see VfxNiagaraImporter.cpp header comment for the mapping
 * table and how it was obtained).
 *
 * Scope this pass (see the export's own report.md / README.md for the same list): life-curves
 * (size/colour/opacity over a particle's life) are approximated by their FIRST key only -- wiring
 * Niagara's curve data-interface modules (ScaleColor's "Linear Color Curve", a "Scale Sprite Size"
 * equivalent) is a real follow-up, not attempted here. Ribbons and lights in effect.json are not
 * yet built into renderers by this plugin (logged, not silently dropped).
 */
UCLASS()
class VFXSTUDIOIMPORTER_API UVfxNiagaraImporter : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Imports the package at PackageDir (a folder containing effect.json and Textures/) into DestPath
	 *  (e.g. /Game/VFXStudio/flamethrower). Returns true on a fully successful import (system created,
	 *  compiled and saved); check the log (category LogVfxImporter) for per-emitter detail either way. */
	UFUNCTION(BlueprintCallable, Category = "VfxStudioImporter")
	static bool ImportPackage(const FString& PackageDir, const FString& DestPath);
};
