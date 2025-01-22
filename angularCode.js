/*

This is a simple angular code that use material design

This is a reactive form that uses  the FormBuilder and FormGroup classes:
The form is bound to the editForm using the [formGroup] directive in the HTML. This approach is better for complex and dynamic forms.

        @Inject(MAT_DIALOG_DATA) public data: any,
 is a Angular's dependency injection that gets data 
 */



import {Component, Inject, OnInit} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {FormBuilder, FormGroup} from '@angular/forms';
import {SalesmanService} from '../../../../core/services';
import {AppLoaderService} from '../../../../shared/services/app-loader';
import {ToasterService} from '../../../../shared/services';

@Component({
    selector: 'app-debt-limit-update',
    templateUrl: './debt-limit-update.component.html'
})

export class DebtLimitUpdateComponent implements OnInit {
    editForm: FormGroup;

    constructor(
        private salesmanService: SalesmanService,
        private loader: AppLoaderService,
        private toastr: ToasterService,
        public dialogRef: MatDialogRef<DebtLimitUpdateComponent>,
        @Inject(MAT_DIALOG_DATA) public data: any,
        private fb: FormBuilder
    ) {
    }

    /**
     * To initialize the trees
     */
    ngOnInit() {
        this.editForm = this.fb.group({
            debtLimit: this.data.debtLimit
        });
    }

    onNoClick(): void {
        this.dialogRef.close(-1);
    }

    onSave(): void {
        this.loader.open();
        this.salesmanService.updateMerchantDebtLimit(this.data.merchantId, this.editForm.value).then(res => {
            this.loader.close();
            this.toastr.success('Debt Limit updated successfully');
            this.dialogRef.close(0);
        }).catch(errInfo => {
            this.loader.close();
            this.toastr.warning(errInfo.rspMessage);
            this.dialogRef.close(1);
        });
    }
}


<h1 mat-dialog-title>Edit Debt Limit</h1>
<div mat-dialog-content>
    <form [formGroup]="editForm">
        <div class="row">
            <div class="col-12 pr-1">
                <mat-form-field class="full-width">
                    <input matInput type="text" name="limit" [formControl]="editForm.controls['debtLimit']"
                           [placeholder]="'Debt Limit'">
                </mat-form-field>
            </div>
        </div>
    </form>
</div>
<div mat-dialog-actions class="justify-content-end">
    <button mat-stroked-button color="primary" class="mr-1" (click)="onNoClick()">Cancel</button>
    <button mat-flat-button color="primary" (click)="onSave()"
            [disabled]="editForm.value.debtLimit === '' || editForm.value.debtLimit === null">Save</button>
</div>

